/*global module, require */

'use strict';

var bsearch = require("./bsearch");
function Database(source)
{
    this.source = source;
    this.symbols = [];
    this.symbolNames = [];
    this.scopes = [];
    this.errors = [];
}

Database.prototype.findSymbol = function(offset) {
    if (this.symbols) {
        function compare(currentElement) {
            if (offset < currentElement.location.start) {
                return 1;
            } else if (offset >= currentElement.location.start && offset < currentElement.location.end) {
                return 0;
            }
            return -1;
        }
        var idx = bsearch(this.symbols, compare);
        if (idx !== undefined) {
            return { pos: this.symbols[idx].location.start, symbol: this.symbols[idx] };
        }
    }
    return undefined;
};

Database.prototype.findSymbolsByName = function(name) {
    if (this.symbolNames) {
        function compare(currentElement) {
            return currentElement.name.localeCompare(name);
        }

        var idx = bsearch(this.symbolNames, compare);
        if (idx !== undefined) {
            var locations = [];
            for (var i=0; i<this.symbolNames[idx].locations.length; ++i) {
                var loc = this.symbolNames[idx].locations[i];
                if (loc[2] == 0 || (loc[2] == 3 && !i))
                    locations.push(loc);
            }
            return { locations: locations };
        }
    }
    return undefined;
};

Database.prototype.listSymbols = function(prefix) {
    var ret = [];
    if (this.symbolNames) {
        var len = this.symbolNames.length;
        var i;
        if (!prefix) {
            for (i=0; i<len; ++i) {
                ret.push(this.symbolNames[i].name);
            }
        } else {
            for ( i=0; i<len; ++i) {
                var name = this.symbolNames[i].name;
                if (name.lastIndexOf(prefix, 0) === 0)
                    ret.push(name);
            }
        }
    }
    return { symbolNames: ret };
};

module.exports = Database;
