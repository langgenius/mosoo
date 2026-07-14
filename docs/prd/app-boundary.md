# App Boundary

Status: historical shipped baseline. [Mosoo Spec](../SPEC.md) is the source of truth wherever the two documents differ.

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

The App-centered console and public-repository deployment flow are implemented in the current Alpha. They are useful for organizing and operating today's Mosoo resources, but the repository does not prove a successful production deployment or recovery exercise.

They do not yet deliver the complete hosted App described by the Spec. The current deployment publishes a website while Agent operations remain a separate part of the App experience.

## User-Visible Boundary

An App is the Builder's product container in Mosoo. Its resources, activity, settings, usage, and deployed site are kept separate from other Apps.

The baseline is single-owner and does not offer organization-wide catalogs or collaboration. Use the Spec—not this historical document—for new launch promises and product decisions.
