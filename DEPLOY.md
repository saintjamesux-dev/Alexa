# Putting Orion in the cloud (always on)

Running on your laptop works, but Orion goes offline when the laptop sleeps. Hosting it in the cloud makes it reachable from your phone anywhere, any time, over HTTPS (which the microphone requires).

**Railway** is the simplest option for this project: it builds the included `Dockerfile` automatically, gives you an HTTPS address, and supports a persistent volume for Orion's memory. Expect roughly $5 a month.

## Steps

1. Sign up at [railway.com](https://railway.com) with your GitHub account.
2. **New Project → Deploy from GitHub repo** and pick this repository. It detects the Dockerfile.
3. Open the service, go to **Variables**, and add the same values as your `.env`:
   - `ANTHROPIC_API_KEY`
   - `ACCESS_CODE`
   - `USER_NAME`
   - `HOME_CITY`
   - Optional: `HONORIFIC`, `EFFORT`, `ELEVENLABS_API_KEY`
4. **Add a volume** (right-click the service, then Volume) mounted at **`/data`**. Without it, Orion forgets everything on each redeploy.
5. Go to **Settings → Networking → Generate Domain**. That `https://…up.railway.app` address is Orion.
6. On your phone, open it in Safari or Chrome, enter your passcode, then **Share → Add to Home Screen**.

Every time you push to `main`, Railway redeploys automatically.

## Moving your laptop memories to the cloud

Optional. If you've been using Orion on your laptop and want the cloud version to remember the same things, the simplest route is to tell it again ("Here's what you should know about me…"). It saves the facts as you talk.

## Security

- The passcode (`ACCESS_CODE`) is the only thing between the internet and your assistant, which spends money on your API key. Make it long: a short sentence is ideal.
- Set a monthly spend limit at platform.claude.com, under **Settings → Limits**, as a safety net.
