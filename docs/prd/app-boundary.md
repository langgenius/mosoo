# App Boundary

Status: shipped resource and ownership boundary. [Mosoo Spec](../SPEC.md) defines the managed Agent runtime contract.

## Problem

Builders previously had to understand Mosoo through separate Agents and scattered resources. The App boundary gives them one place to see and operate the product they are building.

Runs, Agents, files, configuration, usage, and deployment stay attached to that App, so switching Apps does not blur ownership or context.

## Users

This experience serves a single Builder who owns and operates each App. The same person may create several Apps and switch between them. Team members, invitations, roles, and ownership transfer are not available in this baseline.

## User Flow

After first sign-in, Mosoo creates a default App and opens it.

The Builder can create or switch Apps from the Apps page. Inside an App, they can review activity, manage Agents and files, configure supporting resources, and view App settings and usage.

From Overview, the Builder can deploy a public GitHub repository, follow deployment status and history, open the live site, retry or redeploy, and delete the deployment.

Agent conversations and channel delivery remain managed through individual Agents inside the App.

## Current Availability

The App-centered console and managed Agent resources are implemented in the current Alpha. App Deployment is also implemented as a separate public-repository publishing surface, but the repository does not prove a successful production deployment or recovery exercise.

The current deployment publishes a website while Agent operations remain a separate part of the App experience. It is not part of the core runtime and Agent API contract.

## User-Visible Boundary

An App is the Builder's product container in Mosoo. Its resources, activity, settings, usage, and deployed site are kept separate from other Apps.

The baseline is single-owner and does not offer organization-wide catalogs or collaboration. Use the Spec for new runtime and integration promises.
