---
"leadtype": patch
---

Recognize current retrieval AI agents in robots.txt policies and `isAgentUserAgent`: Claude-SearchBot, Claude-User, Perplexity-User, Gemini-Deep-Research, DeepSeekBot, and Meta-ExternalFetcher join the retrieval crawler list, so `block-training` policies keep them allowed and `block-ai` policies actually cover them instead of letting them fall through to the `User-agent: *` group.
