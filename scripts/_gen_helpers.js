'use strict';
// Shared helpers for the schema generators (TBDynamicTrader / TBCarDealer / TBSecondHandMarket).
const D = 'documented', O = 'observed', N = 'inferred';
const F = (label, help, o = {}) => ({ label, help, ...o });
const VER = (extra) => F('Format version', 'Version number of this file format. The mod uses it to upgrade old files. Never change it.', { type: 'string', internal: true, level: 'danger', confidence: D, ...extra });
const INIT = F('Initialised marker', 'Set by the mod after it has written the default file. Never change it; resetting it can make the mod regenerate defaults.', { type: 'flag', internal: true, level: 'danger', confidence: D });
const FLAG = (label, help, o = {}) => F(label, help, { type: 'flag', typical: '0 or 1', confidence: D, ...o });
const LIST = (label, help, o = {}) => F(label, help, { type: 'list', confidence: D, ...o });
const NUM = (label, help, o = {}) => F(label, help, { type: 'number', confidence: D, ...o });
const INT = (label, help, o = {}) => F(label, help, { type: 'int', confidence: D, ...o });
const STR = (label, help, o = {}) => F(label, help, { type: 'string', confidence: D, ...o });
const COORD = F('Coordinate value', 'One number of an [X, Y, Z] triple: X is east-west, Y is height, Z is north-south on the map.', { type: 'number', unit: 'metres', confidence: D, level: 'advanced' });
const ANGLE = F('Angle value', 'One angle of a three-value orientation, in degrees.', { type: 'number', unit: 'degrees', confidence: D, level: 'advanced' });
const hook = (what) => STR('Discord webhook address', 'Web address that ' + what + ' are posted to when the matching Discord switch is on. Treat it like a password: anyone holding it can post to that channel. Leave empty if you do not use it.', { type: 'url', level: 'advanced', risk: 'A wrong or revoked address silently loses the messages.' });
module.exports = { D, O, N, F, VER, INIT, FLAG, LIST, NUM, INT, STR, COORD, ANGLE, hook };
