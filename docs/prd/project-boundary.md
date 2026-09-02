# Project Boundary

Status: shipped resource and ownership boundary. [mosoo Spec](../SPEC.md) defines the managed Agent runtime contract.

## Problem

Builders previously had to understand mosoo through separate Agents and scattered resources. The Project boundary gives them one place to see and operate the product they are building.

Runs, Agents, files, configuration, and usage stay attached to that Project, so switching Projects does not blur ownership or context.

## Users

This experience serves a single Builder who owns and operates each Project. The same person may create several Projects and switch between them. Team members, invitations, roles, and ownership transfer are not available in this baseline.

## User Flow

After first sign-in, mosoo creates a default Project and opens it.

The Builder can create or switch Projects from the Projects page. Inside a Project, they can review activity, manage Agents and files, configure supporting resources, and view Project settings and usage.

Agent conversations remain managed through individual Agents inside the Project.

## Current Availability

The Project-centered console and managed Agent resources are implemented in the current Alpha.

## User-Visible Boundary

A Project is the Builder's product container in mosoo. Its resources, activity, settings, and usage are kept separate from other Projects.

The baseline is single-owner and does not offer organization-wide catalogs or collaboration. Use the Spec for new runtime and integration promises.
