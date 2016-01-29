/*global module */

'use strict';

function Scope(type, range, index)
{
    this.type = type;
    this.range = range;
    this.index = index;
    this.defs = new Map();
    this.count = 0;
    this.parentScopes = [];
    this._objects = new Map();
}

module.exports = Scope;
