# Google Photos Import Setup Guide

## Overview

The Design Library now supports importing images directly from Google Photos. This feature allows you to browse your Google Photos albums and select images to add to design specifications.

## Prerequisites

- Google account with Google Photos
- Google Cloud project (free tier available)
- Photos Library API enabled on the project
- OAuth 2.0 credentials configured

## Step 1: Create or Select a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note the Project ID (you'll need this later)

## Step 2: Enable the Photos Library API

1. In the Google Cloud Console, go to **APIs & Services** → **Library**
2. Search for "Photos Library API"
3. Click on it and then click **Enable**

## Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - Choose **External** for User Type
   - Fill in the required fields:
     - App name: "Stones Throw Studio Workflow"
     - User support email: your email
     - Developer contact: your email
   - Add the following scopes in the scopes section:
     - `https://www.googleapis.com/auth/photoslibrary.readonly`
   - Save and continue

4. After the consent screen is configured, create the OAuth client ID:
   - Application type: **Web application**
   - Name: "STS Workflow Design Library"
   - Authorized redirect URIs:
     - `https://sts-deploy.pages.dev/jewelry-workflow.html`
     - `http://localhost:8000/jewelry-workflow.html` (for local development)
   - Click **Create**

5. Copy the **Client ID** from the credentials page

## Step 4: Configure the App

1. Open the STS Workflow app at https://sts-deploy.pages.dev/jewelry-workflow
2. Click **⚙ Integrations** in the bottom-left sidebar
3. Find the "Google Client ID" field and paste your Client ID
4. Save

## Step 5: Test the Integration

1. Navigate to **🎨 Designs** tab
2. Create a new design or edit an existing one
3. Click **⚙ Actions** button
4. Click **📷 Add from Google Photos**
5. Click to authenticate with Google (you'll be prompted once)
6. Select an album from your Google Photos
7. Select images to add (max 10 per design)
8. Click **Add [N] images**

## Troubleshooting

### "Popup blocked" error
- Allow popups for `sts-deploy.pages.dev` in your browser settings

### "Set up your Google Client ID in Integrations first"
- Verify you've entered the Client ID in the Integrations modal
- Try refreshing the page

### "Failed to load Google Photos"
- Verify the Photos Library API is enabled in Google Cloud
- Check that your OAuth consent screen is configured properly
- Try clicking "Add from Google Photos" again

### Images won't download
- The session may have expired; reconnect by clicking "Add from Google Photos" again
- Check that your Google account has access to the albums shown

## How It Works

1. **Authentication**: Uses Google OAuth 2.0 with the `photoslibrary.readonly` scope
2. **Album Selection**: Fetches your album list from Google Photos API
3. **Image Selection**: Shows thumbnails of photos in the selected album
4. **Download**: Downloads selected images through the app's proxy (`/api/img-fetch`)
5. **Processing**: Images are resized to max 1200px width and converted to JPEG (82% quality), same as manual uploads

## Security Notes

- Photos are downloaded through your app's server proxy (`/api/img-fetch`)
- Google OAuth tokens are stored in `localStorage` with a 1-hour expiry
- Only the `photoslibrary.readonly` scope is used—the app cannot modify your photos
- Tokens are cleared when the app session expires

## For Development

If testing locally:

1. Update your OAuth redirect URIs to include `http://localhost:[port]/jewelry-workflow.html`
2. Use a local client ID (don't use production credentials locally)
3. Run the app locally and test the flow

## Limitations

- Maximum 10 images per design (same as other import methods)
- Videos are skipped (only photos are shown)
- Batch download limit: 100 images per album fetch (UI shows first 100 if album is larger)
