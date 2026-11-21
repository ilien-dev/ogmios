# Connect Ogmios to Claude

**Español:** [CLAUDE-SETUP.es.md](CLAUDE-SETUP.es.md)

Ogmios is free, but the conversations are held by Claude, the AI made by
Anthropic, and Ogmios does not include it. The first time you open Ogmios it
asks you to connect Claude in one of two ways. This page walks through both.

## Option 1: an Anthropic API key (recommended)

An API key is a long password that lets Ogmios use Claude on your behalf. You
pay Anthropic only for what you use: a 20-minute conversation costs roughly
$0.20 with Sonnet 5. That figure is an estimate, not a measurement.

1. Go to [platform.claude.com](https://platform.claude.com) and create an
   account, or sign in.
2. Add credit under **Billing**. A few dollars is enough to start.
3. Open **API keys** and choose **Create key**. Give it a name you will
   recognise, such as `Ogmios`.
4. Copy the key. It starts with `sk-ant-`, and Anthropic shows it only once.
5. In Ogmios, on the **Connect to Claude** screen (or later in **Settings**),
   paste it into **Anthropic API key** and choose **Save key**.
6. Choose **Check connection**. When it answers, pick the model you want.

The key is kept in your system's keychain (Keychain on macOS, Credential
Manager on Windows) and is sent only to Anthropic. **Remove key** deletes it.

If you lose the key or think someone else has it, delete it on Anthropic's
page and create a new one.

## Option 2: Claude Code on this computer

If you already use Claude Code and are signed in to it, Ogmios can run it for
you:

1. Install [Claude Code](https://claude.com/claude-code) and sign in once in a
   terminal by typing `claude`.
2. In Ogmios, choose **Claude Code on this computer**, then **Find claude**.

Ogmios runs the `claude` you installed, as it is, and never sees your
credentials. Anthropic may limit subscription use in third-party apps, so this
way can stop working at any time. If it does, switch to an API key.

## Cost and limits

- You can set a monthly spending limit in Anthropic's console, so a month never
  costs more than you decide.
- **Thinking effort** in Settings trades speed and cost for more careful
  answers. **Automatic** keeps the conversation quick and the feedback careful.

Ogmios is an independent project. It is not affiliated with or endorsed by
Anthropic.
