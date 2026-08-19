# App Deployment

Status: implemented secondary Alpha surface. It is not part of the core managed Agent runtime contract in the [mosoo Spec](../SPEC.md).

## Why It Matters

A Builder may want a simple way to share a supported website alongside a mosoo Agent. App Deployment covers that secondary use case: publish a supported public repository to a mosoo-managed URL and operate that site from the App Overview.

## Who Uses It

The Builder who owns the App controls deployment. App Users only encounter the resulting site; they do not see mosoo's deployment controls. The current baseline supports one owner and one deployed site per App.

## User Flow

1. From App Overview, the Builder enters a public GitHub repository and starts deployment.
2. mosoo uses the repository's default branch and checks whether the project is a supported static or request-handling web app. Unsupported or unclear projects fail with an explanation.
3. Overview shows the attempt as **Deploying**, **Successful**, or **Failed**. After success, the Builder can open the live site and review earlier attempts.
4. The Builder can publish the latest default branch again, change the source repository, or delete the deployment. A failed later attempt does not hide the last successful URL. Deletion removes the hosted site and its Agent access, but never changes the GitHub repository.

Bound Agent URLs are signed bearer capabilities tied to one Deployment and its latest successful binding revision. Before a bound call starts an Agent Run, the API verifies that the Deployment is still active and that the revision still contains the named binding. The final Run insert repeats that D1 authority condition, so a deletion or successful revision replacement that commits during a request cannot create an owner-billed Run. Deleting the Deployment or successfully publishing a revision that removes a binding revokes its prior capability URL. A failed deployment leaves the previous successful revision authorized.

When a bound capability is accepted, the Run records the App, Agent, Deployment, successful Deployment Run, and binding environment/name that delegated that authority. The record never contains the capability URL or signed token and is available only through owner-authorized audit access. It follows the `session_run` lifecycle and is removed with its Run; it has no separate retention store.

## Current Availability and Boundary

The console flow, deployment processing, history, retry, and deletion are implemented. Repository evidence does not prove a successful real production deployment or recovery exercise, so the honest claim is **implemented**, not **production-proven**.

App Deployment is not the canonical mosoo product wedge. Today's baseline publishes one supported public repository to a mosoo-owned URL. It does not itself provide App User authentication, durable backend state, schedules, recovery, private repositories, custom domains, branch previews, automatic deployment, or rollback.
