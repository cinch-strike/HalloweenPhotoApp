import { join } from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

const ROOT = join(import.meta.dirname, '../..');
export const PARAM_PREFIX = '/halloween-contest';

interface Props extends StackProps {
  budgetEmail?: string;
}

/** Everything for the contest. `cdk destroy` removes all of it, photos included (requirements FR-10). */
export class ContestStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const privateBucket = (name: string, extra: Partial<s3.BucketProps> = {}) =>
      new s3.Bucket(this, name, {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        ...extra,
      });

    const siteBucket = privateBucket('Site');
    // Separate from the site bucket so a site redeploy (which prunes) can never touch photos.
    const photosBucket = privateBucket('Photos', {
      // Browsers upload straight to S3 with a presigned POST.
      cors: [{ allowedMethods: [s3.HttpMethods.POST], allowedOrigins: ['*'], allowedHeaders: ['*'] }],
    });

    const table = new dynamodb.TableV2(this, 'Contest', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, 'ApiFunction', {
      entry: join(ROOT, 'api/src/lambda.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        PHOTOS_BUCKET: photosBucket.bucketName,
        PARAM_PREFIX,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        format: OutputFormat.ESM,
        externalModules: [], // bundle the AWS SDK too, so the deployed version matches what was tested
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      depsLockFilePath: join(ROOT, 'package-lock.json'),
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(fn);
    photosBucket.grantReadWrite(fn);
    photosBucket.grantDelete(fn);
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${PARAM_PREFIX}/*`],
    }));

    const api = new apigw.HttpApi(this, 'Gateway', { createDefaultStage: false });
    api.addStage('PublicStage', { stageName: '$default', autoDeploy: true, throttle: { rateLimit: 20, burstLimit: 40 } });
    api.addRoutes({ path: '/api/{proxy+}', methods: [apigw.HttpMethod.ANY], integration: new HttpLambdaIntegration('ApiIntegration', fn) });

    // SPA routing: /tv, /vote, /admin etc. serve index.html; real files (with a dot) pass through.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (r.uri.indexOf('.') === -1) { r.uri = '/index.html'; } return r; }",
      ),
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'Headers', {
      customHeadersBehavior: { customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }] },
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), override: true },
      },
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Halloween costume contest',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL, // includes NZ/AU edge locations
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/photos/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(photosBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: headers,
        },
        '/api/*': {
          origin: new origins.HttpOrigin(`${api.apiId}.execute-api.${this.region}.amazonaws.com`),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(join(ROOT, 'web/dist'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });

    if (props.budgetEmail) {
      new budgets.CfnBudget(this, 'Budget', {
        budget: { budgetName: 'halloween-contest', budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: 10, unit: 'USD' } },
        notificationsWithSubscribers: [{
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetEmail }],
        }],
      });
    }

    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'PhotosBucketName', { value: photosBucket.bucketName });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
