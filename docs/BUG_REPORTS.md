# Bug reports and download stats

Both run on free services. Nothing here needs a payment method.

## Download stats

```bash
node tools/download-stats.cjs
```

It reads GitHub's public release API and lists the downloads of each release's installers and zips. A count is one download of a file, not one person: app updates count too, and one person may download twice. The repository's **Insights → Traffic** page shows visitors and clones for the last 14 days.

## Bug reports

The bug icon beside **⋮**, or **⋮ → Report a bug**, takes a title, a description and up to 3 pictures (3 MB each), and adds the app version and operating system. Nothing else is sent.

- **Without the relay** (the default, `bugReportUrl` empty in `package.json`), the app offers **Send on GitHub instead**. That opens a filled-in issue on the public repository and a folder with the pictures to drag in. The person needs a free GitHub account.
- **With the relay**, reports go straight to issues in a private repository with no account needed.

### Turning on the relay

The relay exists so the GitHub token is not inside the app, where anyone could read it.

1. Create a **private** GitHub repository named `Torque-bug-reports` with a README, so it has a default branch. Reports stay private to you there.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for only that repository, with **Contents: Read and write** and **Issues: Read and write**.
3. Create a free [Cloudflare](https://dash.cloudflare.com/sign-up) account. It does not ask for a card on the free plan.
4. Deploy from `tools/bug-report-relay`, and paste the token when `secret put` asks. Never put it in a file or a chat.

   ```bash
   npx wrangler login
   ```

   ```bash
   npx wrangler deploy
   ```

   ```bash
   npx wrangler secret put GITHUB_TOKEN
   ```

5. Put the `https://torque-bug-reports.<you>.workers.dev` address it prints in `package.json` as `bugReportUrl` and publish a new version.

Change `REPO` in `wrangler.toml` first if the repository has another name. Run `npx wrangler kv namespace create LIMITS` and add the binding it prints to make the limits hold across the whole service.

### Why it does not cost money

- **Cloudflare Workers Free** allows 100,000 requests a day. Past that, requests fail; it does not bill. You could only be charged by choosing a paid plan yourself.
- **GitHub** does not charge for issues or private repositories on a free account, and the relay uses no Actions.
- **Limits in the relay:** 5 reports an hour per network and 50 a day in total, so spam cannot fill the repository. Change `PER_IP_PER_HOUR` and `PER_DAY` in `worker.mjs`.

If the token expires, reports fall back to **Send on GitHub instead** until you set a new one.
