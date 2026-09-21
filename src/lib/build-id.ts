/**
 * Identifies the deployment currently serving this process.
 *
 * Rendered into the page shell and also exposed at `/api/version`, so a tab
 * that has been open across a deploy can notice its HTML is stale by comparing
 * the two. `VERCEL_DEPLOYMENT_ID` changes on every deploy — including a
 * redeploy of the same commit — which the commit SHA alone would miss.
 */
export function buildId(): string {
  return (
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "dev"
  );
}
