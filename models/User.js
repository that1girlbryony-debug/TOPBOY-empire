/**
 * models/User.js — Shim that re-exports from src/models/User.js
 *
 * This exists so legacy code (index.js, _economyLegacy.js, admin/index.js)
 * that does `require("../models/User")` or `require("../../models/User")`
 * resolves to the SAME model as the new economy modules that do
 * `require("../../models/User")` (which resolves to src/models/User.js).
 *
 * Without this shim, Mongoose throws "Cannot overwrite User model once
 * compiled" because two different files would try to compile the same
 * model name with different schemas.
 */

module.exports = require("../src/models/User");
