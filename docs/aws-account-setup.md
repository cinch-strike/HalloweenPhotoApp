# AWS account setup — Halloween Contest

These steps match your existing setup: an AWS Organization with IAM Identity Center (the `cinch-strike` SSO session, used the same way as `alaga-dev`).

## 1. Create the member account (AWS console, management account)

1. Sign in to the **management account** console (the one behind `cs-nexus-admin-profile`).
2. Go to **AWS Organizations → AWS accounts → Add an AWS account → Create an AWS account**.
3. Fill in:
   - **Account name:** `halloween-contest`
   - **Email:** a new, unused address. A plus-alias works, e.g. `donnie+halloween-aws@cinch-strike.io`.
   - **IAM role name:** leave the default, `OrganizationAccountAccessRole`.
4. **Create**, then wait about 1–5 minutes until the account shows as *Active*. Note the 12-digit **account ID**.
5. *(Optional)* Move it into a "Personal" OU if you have one.

> **Billing note:** a member account is still paid by the Organization's payer account (consolidated billing). Keeping it as a separate account lets you see its spend on its own in **Billing → Cost Explorer → filter by Linked account**. To be billed to a personal card instead, you'd need a standalone account outside the Organization. That works with the same steps from §3 onward, but uses an IAM Identity Center instance of its own.

## 2. Give yourself SSO access to it

1. In the management account, open **IAM Identity Center → AWS accounts**.
2. Tick `halloween-contest` → **Assign users or groups** → select yourself → **Next**.
3. Choose the **AdministratorAccess** permission set → **Next → Submit**.

## 3. Add a CLI profile on your Mac

Add this to `~/.aws/config` (replace the account ID):

```ini
[profile halloween]
sso_session = cinch-strike
sso_account_id = <12-digit account id>
sso_role_name = AdministratorAccess
region = ap-southeast-2
output = json
```

Then log in and check it works:

```bash
aws sso login --profile halloween
```

```bash
aws sts get-caller-identity --profile halloween
```

The output should show the new account ID and an `AWSReservedSSO_AdministratorAccess…` role.

## 4. Bootstrap CDK in the new account (one-off)

```bash
cdk bootstrap aws://<12-digit account id>/ap-southeast-2 --profile halloween
```

## 5. Budget alert (the CDK stack creates it)

The stack creates a US$10/month budget that emails `donnie@cinch-strike.io`. You don't need to do anything here.

## 6. Tell Claude when it's done

Once `get-caller-identity` works, say "AWS is ready" and the app will be deployed with `npm run deploy`.

## Teardown after Halloween

See the README, "Teardown". Run `cdk destroy`, then, if you want the account gone too, **Organizations → account → Close account**.
