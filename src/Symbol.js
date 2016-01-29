/*global module */

'use strict';

function Symbol(location, name, scopeIndex, definition)
{
    this.location = location;
    this.name = name;
    // this.target = undefined;
    this.definition = definition || false;
    this.scopeIndex = scopeIndex;
}

module.exports = Symbol;
