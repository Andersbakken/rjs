/*global require, module */

'use strict';

var esprima = require('esprima');
var esrefactor = require('esrefactor');
var estraverse = require('estraverse');
var bsearch = require('./bsearch');
var Database = require('./Database');
var Location = require('./Location');
var Symbol = require('./Symbol');
var Scope = require('./Scope');
var log = require('./log');
var assert = require('assert');
var verbose = require('./Args').args.verbose;

require('util').inspect = require('eyes').inspector({stream:null});

function Indexer(src) {
    this.source = src;
    this._parents = [];
    this._scopeStack = [];
    this._symbolNames = new Map();
    this._db = undefined;
    assert(this.source);
}

Indexer.prototype._childKey = function(child) { // slow
    var p = child.parent;
    for (let key in p) {
        if (p[key] === child) {
            return key;
        }
    }
    return "not found";
};

Indexer.prototype._isChild = function(key, node) {
    if (!node)
        node = this._parents[this._parents.length - 1];

    if (node.parent) {
        var p = node.parent[key];
        if (p !== undefined) {
            if (p instanceof Array) {
                return p.indexOf(node) != -1;
            } else {
                return p == node;
            }
        }
    }
    return false;
};

Indexer.prototype._codeForLocation = function(range) {
    return this.source.code.substring(range[0], range[1]);
};

Indexer.prototype._qualifiedName = function(node) {
    if (!node)
        node = this._parents[this._parents.length - 1];
    var orig = node;
    var seen = [];
    function resolveName(n)
    {
        if (seen.indexOf(n) != -1)
            return undefined;
        seen.push(n);
        if (n) {
            switch (n.type) {
            case esprima.Syntax.Identifier:
                return n.name;
            case esprima.Syntax.Literal:
                return n.value;
            case esprima.Syntax.MemberExpression:
                if (seen.indexOf(n.object) != -1 || seen.indexOf(n.property) != -1)
                    break;
                return resolveName(n.object) + "." + resolveName(n.property);
            case esprima.Syntax.ObjectExpression:
            case esprima.Syntax.Property:
                return resolveName(n.key);
            case esprima.Syntax.VariableDeclarator:
            case esprima.Syntax.FunctionDeclaration:
                return resolveName(n.id);
            case esprima.Syntax.AssignmentExpression:
                return resolveName(n.left);
            case esprima.Syntax.CallExpression:
                return resolveName(n.callee);
            default:
                break;
                // console.log("Not sure how to resolve", node.type, node.range);
            }
        }
        return undefined;
    }

    var name = undefined;
    var prev = undefined;
    while (node) {
        if (node.type) {
            var done = false;
            switch (node.type) {
            case esprima.Syntax.FunctionExpression:
            case esprima.Syntax.FunctionDeclaration:
            case esprima.Syntax.CallExpression:
                done = prev;
                break;
            case esprima.Syntax.AssignmentExpression:
                done = prev && (prev.type != esprima.Syntax.ObjectExpression || node.right != prev);
                // if (done)
                //     console.log("Stopping", orig.range, "at", name, "because of", node.type);
                break;
            case esprima.Syntax.VariableDeclarator:
                done = prev && prev.type != esprima.Syntax.ObjectExpression && this._isChild("init", prev);
                // if (done)
                //     console.log("Stopping", orig.range, "at", name, "because of VariableDeclarator");
                break;
            case esprima.Syntax.MemberExpression:
                done = node.computed;
                break;
            default:
                break;
            }
            if (done)
                break;

            var n = resolveName(node);
            if (n) {
                if (!name) {
                    name = n;
                } else {
                    name = n + "." + name;
                }
            }
            prev = node;
            node = node.parent;
        }
    }
    return name;
};

Indexer.prototype._indexIdentifier = function(node) {
    node.indexed = true;
    var type = Location.MAYBE_REFERENCE;
    var name = undefined;
    switch (node.parent.type) {
    case esprima.Syntax.VariableDeclarator:
        if (this._isChild("init")) {
            type = Location.REFERENCE;
        } else {
            type = Location.DEFINITION;
        }
        break;
    case esprima.Syntax.FunctionDeclaration:
    case esprima.Syntax.FunctionExpression:
    case esprima.Syntax.Property:
    case esprima.Syntax.CatchClause:
        // ### the Identifier for the catch clause should strictly
        // ### speaking be a scope of its own but only for that one
        // ### variable. Not handled right now
        type = Location.DEFINITION;
        break;
    case esprima.Syntax.AssignmentExpression:
        type = Location.MAYBE_REFERENCE;
        break;
    case esprima.Syntax.CallExpression:
    case esprima.Syntax.UnaryExpression:
    case esprima.Syntax.BinaryExpression: // ### ???
    case esprima.Syntax.ReturnStatement:
    case esprima.Syntax.NewExpression:
    case esprima.Syntax.UpdateExpression:
    case esprima.Syntax.ForInStatement:
    case esprima.Syntax.IfStatement:
    case esprima.Syntax.WhileStatement:
    case esprima.Syntax.DoWhileStatement:
    case esprima.Syntax.ForStatement:
    case esprima.Syntax.LogicalExpression:
    case esprima.Syntax.ConditionalExpression:
    case esprima.Syntax.ArrayExpression:
    case esprima.Syntax.SwitchStatement:
        type = Location.REFERENCE;
        break;
    case esprima.Syntax.MemberExpression:
        if (this._isChild("property", node))
            name = this._qualifiedName(node.parent);
        type = (node.parent.parent.type == esprima.Syntax.AssignmentExpression ? Location.MAYBE_REFERENCE : Location.REFERENCE);
        break;
    default:
        // console.log("Shit", node.type);
        console.log("Unhandled parent", node.parent.type, node.parent.range, this._codeForLocation(node.parent.range),
                    node.range, this._codeForLocation(node.range));
        break;
    }
    if (name === undefined)
        name = this._qualifiedName();
    // console.log("  Found identifier", name, node.range, node.type, type);
    var scope = this._scopeStack[this._scopeStack.length - 1];
    if (!scope._objects[name])
        scope._objects[name] = [];
    scope._objects[name].push(new Location(this.source.mainFile, node.range[0], node.range[1], type));
    ++scope.count;
};

Indexer.prototype._onEnter = function(node) {
    if (this._parents.length)
        node.parent = this._parents[this._parents.length - 1];
    this._parents.push(node);
    // console.log("entering", node.type, this._childKey(node));
    switch (node.type) {
    case esprima.Syntax.Program:
    case esprima.Syntax.FunctionExpression:
        node.scope = true;
        break;
    case esprima.Syntax.FunctionDeclaration:
        node.id.parent = node;
        this._indexIdentifier(node.id);
        node.scope = true;
        break;
    case esprima.Syntax.Identifier:
        if (!node.indexed) {
            // we need to handle the function itself as part of the previous scope
            this._indexIdentifier(node);
        }
        break;
    default:
        break;
    }
    if (node.scope) {
        // ### should have a prototype
        var scope = new Scope(node.type, node.range, this._db.scopes.length);
        this._scopeStack.push(scope);
        // console.log("adding a scope", node.type, node.range);
        this._db.scopes.push(scope);
    }
};

Indexer.prototype._onLeave = function(node) {
    this._parents.pop();
    if (node.scope) {
        var scope = this._scopeStack.pop();
        // console.log("popping a scope", scope.type, scope.range);
        for (let i=0; i<this._scopeStack.length; ++i) {
            scope.parentScopes.push(this._scopeStack[i].index);
        }
    }
};

Indexer.prototype._add = function(name, scope)
{
    var i;
    var locations = scope._objects[name];
    // console.log("    add", name, locations, scope.index, scope.parentScopes);
    for (i=0; i<locations.length; ++i) {
        // console.log("considering", name, JSON.stringify(locations[i]));
        if (locations[i].type != Location.REFERENCE) {
            if (!this._symbolNames[name]) {
                this._symbolNames[name] = [ locations[i] ];
            } else {
                this._symbolNames[name].push(locations[i]);
            }
        }
    }
    // console.log(this._db.symbolNames);

    var defObj;
    var newDef = false;
    if (locations[0].type !== Location.REFERENCE) {
        defObj = new Symbol(locations[0], name, scope.index, true);
        newDef = true;
    }
    if (locations[0].type === Location.DEFINITION) {
        scope.defs[name] = defObj;
    } else { // not a perfect hit, we need to search parent scopes
        for (let idx=scope.parentScopes.length - 1; idx>=0; --idx) {
            var parentScope = this._db.scopes[scope.parentScopes[idx]];
            var def = parentScope.defs[name];
            if (def && (!defObj || def.location.type === Location.DEFINITION)) {
                newDef = false;
                defObj = def;
                break;
            }
        }
    }
    if (newDef) {
        scope.defs[name] = defObj;
        this._db.symbols.push(defObj);
        i = 1;
    } else {
        i = 0;
    }
    while (i < locations.length) {
        var loc = locations[i];
        var obj = new Symbol(loc, name, scope.index);
        if (defObj) {
            // defObj.references.push(loc);
            obj.target = defObj.location;
            // console.log("setting target", defObj.location, "for", loc);
            // console.log("BALLING", obj, defObj);
        }
        // console.log("REALLY ADDING AN OBJECT", obj);
        this._db.symbols.push(obj);
        ++i;
    }
};

Indexer.prototype.index = function() {
    if (this.source.code.lastIndexOf("#!", 0) === 0) {
        var ch = 0;
        var header = "";
        while (ch < this.source.code.length && this.source.code.charCodeAt(ch) !== 10) {
            ++ch;
            header += " ";
        }
        this.source.code = header + this.source.code.substring(ch);
        // console.log("replaced", ch);
    }
    var esrefactorContext = new esrefactor.Context();
    var parsed;
    try {
        parsed = esprima.parse(this.source.code, { tolerant: true, range: true });
    } catch (err) {
        log.log("Got error", err);
        this._db = new Database(this.source);
        this._db.errors.push(err);
        return this.db;
    }

    if (!parsed)
        throw new Error("Couldn't parse file " + this.source.mainFile + ' ' + this.source.code.length);

    esrefactorContext.setCode(parsed);
    if (!esrefactorContext._syntax)
        throw new Error('Unable to identify anything without a syntax tree');

    // console.log("BALLS", JSON.stringify(parsed, null, 4));

    this._db = new Database(this.source);
    estraverse.traverse(esrefactorContext._syntax, { enter: this._onEnter.bind(this), leave: this._onLeave.bind(this) });

    var that = this;
    var s;
    for (s=0; s<this._db.scopes.length; ++s) {
        var scope = this._db.scopes[s];
        // console.log(JSON.stringify(scope));
        // continue;
        // console.log("Adding things for scope", s, scope.count, _db.scopes.length, scope.type, scope.range);
        if (scope.count) {
            for (let name in scope._objects) {
                scope._objects[name].sort(function(l, r) {
                    var ret = l.type - r.type;
                    if (!ret)
                        ret = l.start - r.start;
                    return ret;
                });
                this._add(name, scope);
            }
        }
    }

    //     for (var f in dbs) {
    //         dbs[f].sort(function(l, r) {
    //             var ret = l.start - r.start;
    //             if (!ret)
    //                 ret = l.end - r.end;
    //             return ret;
    //         });
    //         split[f].symbolNames.push({ name: n, locations: dbs[f] });
    //     }
    // }
    // for (var db in split) {
    //     split[db].symbolNames.sort(function(l, r) { return l.name.localeCompare(r.name); });


    for (let name in this._symbolNames) {
        let locations = this._symbolNames[name];
        locations.sort(Location.compare);
        this._db.symbolNames.push({ name: name, locations: locations });
    }
    this._db.symbolNames.sort(function(l, r) { return l.name.localeCompare(r.name); });

    // console.log("SHIT", this._db.symbolNames);
    for (s=0; s<this._db.scopes.length; ++s) {
        delete this._db.scopes[s]._objects;
    }

    this._db.symbols.sort(Location.compare);

    if (verbose >= 2) {
        // stop being circular
        estraverse.traverse(esrefactorContext._syntax, {
            enter: function(node) {
                delete node.parent;
                delete node.indexed;
            }
        });
        this._db.ast = esrefactorContext._syntax;
    }
    if (esrefactorContext._syntax.errors)
        this._db.errors = esrefactorContext._syntax.errors;
    // console.log(file, "indexed");

    // console.log(ret.symbols);
    // var split = {};
    // for (let i=0; i<ret.symbols.length; ++i) {
    //     var sym = ret.symbols[i];
    //     sym.location = this.source.resolve(sym.location);
    //     // console.log(loc);
    //     if (sym.references) {
    //         for (let r=0; r<sym.references.length; ++r) {
    //             sym.references[r] = this.source.resolve(sym.references[r]);
    //         }
    //     }

    //     if (sym.target) {
    //         sym.target = this.source.resolve(sym.target);
    //     }
    //     // if (loc.file !== this.source.mainFile) {
    //     //     var diff = sym.location[0] - loc.index;
    //     //     sym.location[0] = loc.index;
    //     //     sym.location[1] -= diff;
    //     // }
    //     if (!split[sym.location.file]) {
    //         log.verboseLog("Creating database for " + sym);
    //         split[sym.location.file] = new Database(sym.location.file, this.source.indexTime, [ sym ]);
    //     } else {
    //         log.verboseLog("ADDING SYM", sym);
    //         split[sym.location.file].symbols.push(sym);
    //     }
    // }
    // // console.log(JSON.stringify(split, null, 4));
    // // need to resolve symbolNames

    // // console.log(symbolNames);
    // for (let symbolName in symbolNames) {
    //     var dbs = {};
    //     var n = symbolName.substr(0, symbolName.length - 1);
    //     symbolNames[symbolName].forEach(function(loc) {
    //         var resolved = this.source.resolve(loc);
    //         if (!dbs[resolved.file]) {
    //             dbs[resolved.file] = [ resolved ];
    //         } else {
    //             dbs[resolved.file].push(resolved);
    //         }
    //     }, this);
    //     for (let f in dbs) {
    //         dbs[f].sort(function(l, r) {
    //             var ret = l.start - r.start;
    //             if (!ret)
    //                 ret = l.end - r.end;
    //             return ret;
    //         });
    //         split[f].symbolNames.push({ name: n, locations: dbs[f] });
    //     }
    // }
    // for (let db in split) {
    //     split[db].symbolNames.sort(function(l, r) { return l.name.localeCompare(r.name); });
    //     log.verboseLog(db, JSON.stringify(split[db], null, 4));
    // }

    // console.log(split);
    // console.log(JSON.stringify(this._db.scopes, null, 4));
    // console.log(JSON.stringify(this._db.symbolNames, null, 4));
    console.log(this._db.symbols);
    // console.log(this._db.scopes);
    return this._db;
    // return split;
};

module.exports = Indexer;
