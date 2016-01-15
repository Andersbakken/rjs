/*global require, module */
var esprima = require('esprima');
var esrefactor = require('esrefactor');
var estraverse = require('estraverse');
var bsearch = require('./bsearch');
var Database = require('./Database');
var Location = require('./Location');
var log = require('./log');

function indexFile(src, verbose)
{
    if (src.code.lastIndexOf("#!", 0) === 0) {
        var ch = 0;
        var header = "";
        while (ch < src.code.length && src.charCodeAt(ch) !== 10) {
            ++ch;
            header += " ";
        }
        src.code = header + src.code.substring(ch);
        // console.log("replaced", ch);
    }
    var ret;
    var esrefactorContext = new esrefactor.Context();
    var parsed;
    try {
        parsed = esprima.parse(src.code, { tolerant: true, range: true });
    } catch (err) {
        console.log("Got error", err, "for", src.code);
        ret = {};
        ret[src.mainFile] = new Database(src.mainFile, src.indexTime, undefined, undefined, [err]);
        return ret;
    }

    if (!parsed)
        throw new Error("Couldn't parse file " + src.mainFile + ' ' + src.code.length);

    esrefactorContext.setCode(parsed);
    if (!esrefactorContext._syntax)
        throw new Error('Unable to identify anything without a syntax tree');

    var parents = [];

    // console.log("BALLS", JSON.stringify(parsed, null, 4));

    function codeForLocation(range)
    {
        return src.code.substring(range[0], range[1]);
    }
    function childKey(child) // slow
    {
        var p = child.parent;
        for (var key in p) {
            if (p[key] === child) {
                return key;
            }
        }
        return "not found";
    }
    function isChild(key, node)
    {
        if (!node)
            node = parents[parents.length - 1];

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
    }

    var scopes = [];
    var scopeStack = [];

    function qualifiedName(node)
    {
        if (!node)
            node = parents[parents.length - 1];
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
                    done = prev && prev.type != esprima.Syntax.ObjectExpression && isChild("init", prev);
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
    }

    function indexIdentifier(node)
    {
        node.indexed = true;
        var rank = Location.MAYBE_REFERENCE;
        var name = undefined;
        switch (node.parent.type) {
        case esprima.Syntax.VariableDeclarator:
            if (isChild("init")) {
                rank = Location.REFERENCE;
            } else {
                rank = Location.DEFINITION;
            }
            break;
        case esprima.Syntax.FunctionDeclaration:
        case esprima.Syntax.FunctionExpression:
        case esprima.Syntax.Property:
        case esprima.Syntax.CatchClause:
            // ### the Identifier for the catch clause should strictly
            // ### speaking be a scope of its own but only for that one
            // ### variable. Not handled right now
            rank = Location.DEFINITION;
            break;
        case esprima.Syntax.AssignmentExpression:
            rank = Location.MAYBE_REFERENCE;
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
            rank = Location.REFERENCE;
            break;
        case esprima.Syntax.MemberExpression:
            if (isChild("property", node))
                name = qualifiedName(node.parent);
            rank = (node.parent.parent.type == esprima.Syntax.AssignmentExpression ? Location.MAYBE_REFERENCE : Location.REFERENCE);
            break;
        default:
            // console.log("Shit", node.type);
            console.log("Unhandled parent", node.parent.type, node.parent.range, codeForLocation(node.parent.range),
                        node.range, codeForLocation(node.range));
            break;
        }
        if (name === undefined)
            name = qualifiedName();
        // console.log("  Found identifier", name, node.range, node.type, rank);
        name += '_';
        node.range.push(rank);
        var scope = scopeStack[scopeStack.length - 1];
        if (scope.objects[name]) {
            scope.objects[name].push(node.range);
        } else {
            scope.objects[name] = [node.range];
        }
        ++scope.count;
    }

    estraverse.traverse(esrefactorContext._syntax, {
        enter: function (node) {
            if (parents.length)
                node.parent = parents[parents.length - 1];
            parents.push(node);
            // console.log("entering", node.type, childKey(node));
            switch (node.type) {
            case esprima.Syntax.Program:
            case esprima.Syntax.FunctionExpression:
                node.scope = true;
                break;
            case esprima.Syntax.FunctionDeclaration:
                node.id.parent = node;
                indexIdentifier(node.id);
                node.scope = true;
                break;
            case esprima.Syntax.Identifier:
                if (!node.indexed) {
                    // we need to handle the function itself as part of the previous scope
                    indexIdentifier(node);
                }
                break;
            default:
                break;
            }
            if (node.scope) {
                var scope = { objects: {}, count: 0, type: node.type, index: scopes.length, defs: {}, range: node.range };
                scopeStack.push(scope);
                // console.log("adding a scope", node.type, node.range);
                scopes.push(scope);
            }
        },
        leave: function (node) {
            parents.pop();
            if (node.scope) {
                var scope = scopeStack.pop();
                // console.log("popping a scope", scope.type, scope.range);
                scope.scopeStack = [];
                for (var i=0; i<scopeStack.length; ++i) {
                    scope.scopeStack.push(scopeStack[i].index);
                }
            }
        }
    });

    var symbolNames = {};
    ret = new Database(src.file, src.indexTime);
    function add(name, scope) {
        var locations = scope.objects[name];
        // console.log("    add", name, locations, scope.index, scope.scopeStack);
        // ### not working
        // for (var i=0; i<locations.length; ++i) {
        //     // console.log("considering", name, JSON.stringify(locations[i]));
        //     if (locations[i][2] > 0) {
        //         if (!symbolNames[name]) {
        //             symbolNames[name] = locations;
        //         } else {
        //             symbolNames[name] = symbolNames[name].concat(locations);
        //         }
        //     }
        // }

        var i;
        var defObj;
        var newDef = false;
        if (locations[0][2] !== Location.REFERENCE) {
            defObj = { location: locations[0], definition: true, name: name.slice(0, -1), references: [] };
            newDef = true;
        }
        if (locations[0][2] === Location.DEFINITION) {
            scope.defs[name] = defObj;
        } else { // not a perfect hit, we need to search parent scopes
            for (var idx=scope.scopeStack.length - 1; idx>=0; --idx) {
                var parentScope = scopes[scope.scopeStack[idx]];
                var def = parentScope.defs[name];
                if (def && (!defObj || def.location[2] === Location.DEFINITION)) {
                    newDef = false;
                    defObj = def;
                    break;
                }
            }
        }
        if (newDef) {
            scope.defs[name] = defObj;
            ret.symbols.push(defObj);
            i = 1;
        } else {
            i = 0;
        }
        while (i < locations.length) {
            var loc = locations[i];
            var obj = { location: loc, name: name };
            if (defObj) {
                defObj.references.push(loc.slice());
                obj.target = defObj.location.slice();
            }
            // console.log("REALLY ADDING AN OBJECT", obj);
            ret.symbols.push(obj);
            ++i;
        }
    }
    for (var s=0; s<scopes.length; ++s) {
        var scope = scopes[s];
        // console.log(JSON.stringify(scope));
        // continue;
        // console.log("Adding things for scope", s, scope.count, scopes.length, scope.type, scope.range);
        if (scope.count) {
            for (var name in scope.objects) {
                scope.objects[name].sort(function(l, r) {
                    var ret = l[2] - r[2];
                    if (!ret)
                        ret = l[0] - r[0];
                    return ret;
                });
                add(name, scope);
            }
        }
    }
    ret.symbols.sort(function(l, r) {
        var ret = l.location[0] - r.location[0];
        if (!ret)
            ret = l.location[1] - r.location[1];
        return ret;
    });

    if (verbose >= 2) {
        estraverse.traverse(esrefactorContext._syntax, {
            enter: function(node) {
                delete node.parent;
                delete node.indexed;
            }
        });
        ret.ast = esrefactorContext._syntax;
    }
    if (esrefactorContext._syntax.errors)
        ret.errors = esrefactorContext._syntax.errors;
    // console.log(file, "indexed");

    var split = {};
    // console.log(JSON.stringify(ret, undefined, 4));
    // function resolveLocation(arr) {
    //     var resolved = src.resolve(arr[0]);
    //     // console.log("resolving ", arr[0], resolved, cmp, addFile, (resolved.file == cmp));
    //     var diff = arr[0] - resolved.index;
    //         arr[0] = resolved.index;
    //         arr[1] -= diff;
    //         if (addFile) {
    //             arr[3] = resolved.file;
    //         }
    //     }
    //     return resolved;
    // }
    // console.log(ret.symbolNames);
    for (var i=0; i<ret.symbols.length; ++i) {
        var sym = ret.symbols[i];
        sym.location = src.resolve(sym.location);
        // console.log(loc);
        if (sym.references) {
            for (var r=0; r<sym.references.length; ++r) {
                sym.references[r] = src.resolve(sym.references[r]);
            }
        }

        if (sym.target) {
            sym.target = src.resolve(sym.target);
        }
        // if (loc.file !== src.mainFile) {
        //     var diff = sym.location[0] - loc.index;
        //     sym.location[0] = loc.index;
        //     sym.location[1] -= diff;
        // }
        if (!split[sym.location.file]) {
            log.verboseLog("Creating database for " + sym.location);
            split[sym.location.file] = new Database(sym.location.file, src.indexTime, [ sym ]);
        } else {
            split[sym.location.file].symbols.push(sym);
        }
    }
    // console.log(JSON.stringify(split, null, 4));
    // need to resolve symbolnames

    for (var symbolName in symbolNames) {
        var dbs = {};
        var n = symbolName.substr(0, symbolName.length - 1);
        symbolNames[symbolName].forEach(function(loc) {
            var resolved = src.resolve(loc);
            console.log("shit", symbolName, resolved);
            if (!dbs[resolved.file]) {
                dbs[resolved.file] = [ resolved ];
            } else {
                dbs[resolved.file].push(resolved);
            }
        });
        for (var f in dbs) {
            dbs[f].sort(function(l, r) {
                var ret = l.start - r.start;
                if (!ret)
                    ret = l.end - r.end;
                return ret;
            });
            split[f].symbolNames.push({ name: n, locations: dbs[f] });
        }
    }
    for (var db in split) {
        split[db].symbolNames.sort(function(l, r) { return l.name.localeCompare(r.name); });
        console.log(db, JSON.stringify(split[db], null, 4));
    }

    // console.log(split);
    return split;
}

module.exports = indexFile;
