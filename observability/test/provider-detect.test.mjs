import assert from "node:assert/strict";
import { detectPlatformFromUrl } from "../provider-detect.ts";
assert.equal(detectPlatformFromUrl("https://api.anthropic.com/v1/messages"), "anthropic");
assert.equal(detectPlatformFromUrl("https://my.openai.azure.com/openai/deployments/x/chat/completions"), "azure");
assert.equal(detectPlatformFromUrl("https://bedrock-runtime.us-east-1.amazonaws.com/model/x/invoke"), "bedrock");
assert.equal(detectPlatformFromUrl("https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent"), "google-ai-studio");
console.log("provider-detect.test.mjs: ok");
