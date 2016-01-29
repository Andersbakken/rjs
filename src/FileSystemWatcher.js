/*global require, process, module*/

'use strict';

var fs = require('fs');

var watched = {};
var listeners = {};

function listener(file) {
    if (!listeners[file]) {
        listeners[file] = function() {
            watched[file].forEach(function(func) {
                func(file);
            });
        };
    }
    return listeners[file];
}
function watch(file, func) {
    if (!watched[file]) {
        watched[file] = [];
        listeners[file] = fs.watch(file, listener(file));
    }
    watched[file].push(func);
}

function unwatch(file, func)
{
    if (!watched[file])
        return false;

    if (func) {
        var idx = watched[file].indexOf(func);
        if (idx == -1)
            return false;
        if (watched[file].length !== 1) {
            watched[file].splice(idx, 1);
            return true;
        }
    }
    delete watched[file];
    listeners[file].close();
    delete listeners[file];
    return true;
}

function clear()
{
    for (let file in listeners) {
        unwatch(file);
    }
}


module.exports = {
    watch: watch,
    unwatch: unwatch,
    clear: clear
};
