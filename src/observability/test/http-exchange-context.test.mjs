import assert from "node:assert/strict";
import {
	getActiveExchangeId,
	getMostRecentExchangeId,
	resetExchangeContext,
	setActiveExchangeId,
} from "../../http-exchange-context.ts";

resetExchangeContext();
setActiveExchangeId("exchange-a");
assert.equal(getActiveExchangeId(), "exchange-a");
assert.equal(getMostRecentExchangeId(), "exchange-a");

setActiveExchangeId(null);
assert.equal(getActiveExchangeId(), null);
assert.equal(getMostRecentExchangeId(), "exchange-a", "message_end can still attach usage after stream close");

setActiveExchangeId("exchange-b");
assert.equal(getMostRecentExchangeId(), "exchange-b");
resetExchangeContext();
assert.equal(getActiveExchangeId(), null);
assert.equal(getMostRecentExchangeId(), null);

console.log("http-exchange-context.test.mjs: ok");
