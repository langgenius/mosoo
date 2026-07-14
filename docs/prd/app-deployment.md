# App Deployment

Status: implemented migration baseline. This is not yet the complete Production Alpha Release experience defined by the [Mosoo Spec](../SPEC.md).

## Why It Matters

A Builder with a working agentic App should not need to become a deployment specialist just to share it. App Deployment covers a narrower first step: publish a supported public repository to a Mosoo-managed URL and operate that site from the App Overview.

## Who Uses It

The Builder who owns the App controls deployment. App Users only encounter the resulting site; they do not see Mosoo's deployment controls. The current baseline supports one owner and one deployed site per App.

## User Flow

1. From App Overview, the Builder enters a public GitHub repository and starts deployment.
2. Mosoo uses the repository's default branch and checks whether the project is a supported static or request-handling web app. Unsupported or unclear projects fail with an explanation.
3. Overview shows the attempt as **Deploying**, **Successful**, or **Failed**. After success, the Builder can open the live site and review earlier attempts.
4. The Builder can publish the latest default branch again, change the source repository, or delete the deployment. A failed later attempt does not hide the last successful URL. Deletion removes the hosted site and its Agent access, but never changes the GitHub repository.

Bound Agent URLs are signed bearer capabilities tied to one Deployment and its latest successful binding revision. Before a bound call starts an Agent Run, the API verifies that the Deployment is still active and that the revision still contains the named binding. The final Run insert repeats that D1 authority condition, so a deletion or successful revision replacement that commits during a request cannot create an owner-billed Run. Deleting the Deployment or successfully publishing a revision that removes a binding revokes its prior capability URL. A failed deployment leaves the previous successful revision authorized.

## Current Availability and Boundary

The console flow, deployment processing, history, retry, and deletion are implemented. Repository evidence does not prove a successful real production deployment or recovery exercise, so the honest claim is **implemented**, not **production-proven**.

The canonical Spec supersedes the older idea that App Deployment is merely an external Web artifact. Its target is a strict Deployable Repo becoming a managed Release for authenticated App Users, with durable state, Agent Workload Runs, and recovery. Today's baseline publishes one supported public repository to a Mosoo-owned URL. It does not itself provide App User authentication, durable backend state, schedules, recovery, private repositories, custom domains, branch previews, automatic deployment, or rollback.
