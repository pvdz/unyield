// TODO parseCompleteBlock might fail..? (try/catch/finally, not even sure how they work at all) and funcexpr

function yieldify(input) {
  var prefix = '_\u03b3_';
  var pBefore = Par.parse(input, {saveTokens:true,createBlackStream:true});
  var wlistBefore = pBefore.tok.tokens;
  var blistBefore = pBefore.tok.black;

  // convert `for` and `do-while` to `while`
  for (var i=0; i<blistBefore.length; ++i) {
    var token = blistBefore[i];
    if (token.isVarToken) {
      if (token.isForEach) {
        // for (ONE;TWO;THREE) x;
        // for (ONE;TWO;THREE) { x; }
        // - put ONE before `for`
        // - put TWO inside header
        // - put THREE at the end of for-statement
        // ONE;for(TWO) { x; THREE; }

        var start = token.lhp.white; // skip `for(`
        var semi1 = token.semi1.white;
        var semi2 = token.semi2.white;
        var end = token.rhp.white;

        var one = wlistBefore.slice(start+1, semi1).map(function(o){ var v = o.value;o.value = ''; return v; }).join('');
        wlistBefore[semi1].value = '';
        var two = wlistBefore.slice(semi1+1, semi2).some(function(o){ return o.black; });
        wlistBefore[semi2].value = '';
        var three = wlistBefore.slice(semi2+1, end).map(function(o){ var v = o.value;o.value = ''; return v; }).join('');

        token.value = '{'+one+';'+'while';
        if (!two) token.lhp.value += 'true';
        var target = blistBefore[token.stmtEnd.black-1];
        if (blistBefore[token.rhp.black+1].value === '{') {
          target.value = three+';}'+target.value;
        } else {
          token.rhp.value += '{';
          token.stmtEnd.value = (token.stmtEnd.value===';'?'':';')+three+';}}' + token.stmtEnd.value;
        }

        i = token.rhp.white;
      } else if (token.isForIn) {
        // for (var key in (rhs)) stmt
        // for ((lhs) in (expr)) stmt

        // https://gist.github.com/qfox/9121615
        // for token has .inToken and .lhp .rhp, so we can just slice them out
        // we could re-use the var if any, but let's leave that for the v2 :)

        var lhp = token.lhp.white;
        var inw = token.inToken.white;
        var rhp = token.rhp.white;


        token.value = ''; // clear `for`
        wlistBefore[lhp].value = ''; // `(`
        if (blistBefore[token.lhp.black+1].value === 'var') {
          // drop `var` to make sure lhs is expression
          var useVar = true;
          blistBefore[token.lhp.black+1].value = '';
        }
        var lhs = wlistBefore.slice(lhp+1, inw).map(function(o){ var v = o.value; o.value = ''; return v; }).join(''); // clear lhs
        wlistBefore[inw].value = ''; // `in`
        var rhs = wlistBefore.slice(inw+1, rhp).map(function(o){ var v = o.value; o.value = ''; return v; }).join(''); // clear rhs
        wlistBefore[rhp].value = ''; // `)`

        token.value =
          // note: `var` will be dropped in the final transformation because the var is hoisted...
          (useVar?'var ':'')+lhs+';\n'+
            'var '+prefix+'key, '+prefix+'keys_'+token.black+' = [], '+prefix+'expro_'+token.black+' = ('+rhs+');\n'+
            'for ('+prefix+'key in '+prefix+'expro_'+token.black+') '+prefix+'keys_'+token.black+'.push('+prefix+'key);\n'+
            'while ('+prefix+'keys_'+token.black+'.length)\n' +
            'if (' +
              prefix+'keys_'+token.black+'[0] in '+prefix+'expro_'+token.black +
              // this looks a big convoluted but prevents us having to block-wrap the statement :)
              ' && !void('+lhs+' = '+prefix+'keys_'+token.black+'.shift())' +
            ')\n';
        // original statement goes here, should still work as before
      } else {
        console.warn('unknown for-loop?');
      }
    } else if (token.isDo) {
      // fairly simple
      // do block while (exprs);
      // block while(exprs) block

      // we dont need the `do` anymore. we'll need to wrap the result in a block though
      token.value = '{';
      // leave block as is. we'll _copy_ it after the while too
      var block = wlistBefore.slice(token.lhc.white, token.rhc.white).map(function(o){ return o.value; }).join('');
      // replace the _mandatory_ semi token with the block value
      blistBefore[token.rhp.black+1].value = block +
        // and close the outer-block to make sure the whole thing remains one statement
        '}';
    }
  }
  // end of loop conversion

  var processedInput = wlistBefore.map(function(o){ return o.value; }).join('');
//  console.log(processedInput);

  // parse processed input again
  var p = Par.parse(processedInput, {saveTokens:true,createBlackStream:true});

  var wlist = p.tok.tokens;
  var blist = p.tok.black;

  // fetch yields and preprocess `with` statements (they're very special)
  var yields = [];
  for (var i=0, len=blist.length; i<len; ++i) {
    var token = blist[i];
    if (token.isYield) {
      yields.push(token);
      token.yieldId = yields.length; // 0 is default func
    } else if (token.isWithKeyword) {
      token.lhp.value += prefix+'withVar_'+token.black+' = (';
      token.rhp.value = ')'+token.rhp.value;
    }
  }

  for (i=0, len=yields.length; i<len; ++i) {
    var currentYield = yields[i];
    var func = currentYield.funcToken;

    if (currentYield.processed) continue;
    currentYield.processed = true;

    // get all yields for the same function as "the next yield"
    var currentYields = yields.filter(function(y){
      var v = !y.processed && y.funcToken === func;
      if (v) y.processed = true;
      return v;
    });
    // include the original one
    currentYields.unshift(currentYield);

    // get start of function
    // makes sure that existing structures remain to function properly
    var statementVars = [];
    currentYields.forEach(function(currentYield) {
      var p = currentYield.statementStart;
      var s = [];
      var catchPart = '} catch(e) {';
      while (p) {
        // yieldStatement => yield in header of statement
        var isYieldStatement = p === currentYield.statementStart;

        if (p.isIfKeyword) {
          if (!isYieldStatement) {
            s.unshift('if (true)');
          } else {
//            s.unshift('if ('+prefix+'ieldValue_'+currentYield.yieldId+')');
//            blist[p.black+1].value += 'if (';
//            blist[p.stmtStart.black-1].value = ')' + blist[p.stmtStart.black-1].value;
          }
        } else if (p.isSwitchKeyword) {
          if (!isYieldStatement) {
            statementVars.push(prefix+'switchToken_'+p.black+' = {}');
            s.unshift('switch ('+prefix+'switchToken_'+p.black+') { case '+prefix+'switchToken_'+p.black+':');
          }
        } else if (p.isWhileKeyword) {
          if (isYieldStatement) {
            // `while(yield);` or such
            // broke must be initialized to whatever the yieldValue

            s.unshift(
              'for (' +
                'var '+prefix+'whileOnce_'+p.black+' = true, '+prefix+'broke_'+ p.black+';' +
                prefix+'whileOnce_'+p.black+'; ' +
                prefix+'whileOnce_'+p.black+' = false' +
              ')');

            // replace `while` with `if`, prevents endless yielding loop
            p.value = 'if';

            blist[p.black+1].value += '!('+prefix+'broke_'+ p.black+' = !(';
            blist[p.stmtStart.black-1].value = '))' + blist[p.stmtStart.black-1].value;
          } else {
            s.unshift(
              'for (' +
                'var '+prefix+'whileOnce_'+p.black+' = true, '+prefix+'broke_'+ p.black+' = false;' +
                prefix+'whileOnce_'+p.black+'; ' +
                prefix+'whileOnce_'+p.black+' = false' +
              ')');
          }
        } else if (p.isTryKeyword) {
          if (s[0] === catchPart) {
            // turn the catch of a try/catch into a regular block
            s[0] = '{';
          } else {
            s.unshift('/*1*/try {');
          }
        } else if (p.isCatchKeyword) {
          s.unshift(catchPart);
        } else if (p.isBlockStart) {
          s.unshift('{');
        } else if (p.isWithKeyword) {
          if (!isYieldStatement) {
            statementVars.push(prefix+'withVar_'+p.black+' = undefined');
            // if invoking this function, the with must have executed, so we can rely on the withVar being set
            s.unshift('with ('+prefix+'withVar_'+p.black+')');
          }
        }

        p = p.parentStatement;
      }

      currentYield.genFunctionStart = s.join('\n');
    });

    if (blist[func.black+1].value === '*') blist[func.black+1].value = '';

    var funcs = currentYields.map(function(yToken, index){
      // we will slice out the yield+expr
      // [A        [B   C]       D]
      // [stmstart [yield] stmtend]

      var yieldExpr = wlist.slice(yToken.white+1, yToken.exprEnd.white).map(function(o){ var v = o.value;o.value = ''; return v; }).join('');

      var stmtStart = yToken.statementStart.white;
      var stmtEnd = yToken.statementStart.statementEnd.white;

      wlist[stmtStart].yieldStatementStart = yToken;

      // mark this a yield statement for this function
      wlist.slice(stmtStart, stmtEnd).forEach(function(o){ o.inYieldStmt = index+1; });

      yToken.returnCode = 'return ('+prefix+'ielded=true, '+prefix+'nextId = '+yToken.yieldId+', '+(yieldExpr||undefined)+')\n';
      yToken.yieldValueVar = prefix+'ieldValue_'+yToken.yieldId/*+'\n'*/;
      yToken.value = yToken.returnCode;

      var o = {
        output: [],
        id: yToken.yieldId,
        init: yToken.genFunctionStart,
        white: yToken.white,

        stmtStart: stmtStart,
        stmtEnd: stmtEnd,

        yieldExpr: yieldExpr,
      };

      return o;
    });

//    // clean the yield statement ranges, except for the yield keyword (value has been changed)
//    funcs.forEach(function(o){
//      wlist.slice(o.stmtStart, o.stmtEnd).forEach(function(o){
//        if (!o.isYield) o.value = '';
//      });
//    });

    var f0 = [];
    var vars = [];

    // we reconstruct two functions
    // first function is the init function and resembles the original
    // except for the yield. at the point of yield it will return its
    // operand and no longer yield.
    // the second function will start at the yield. previous blocks
    // will simply start with a {, the rest remains the same.

    function processSlice(start, end, whiling) {
      var out0point = f0.length;
      var outpoints = funcs.map(function(o){ return o.output.length; });
      var foundYield = false;
      if (!whiling) whiling = 0;

      for (var j=start; j<end; ++j) {
        var t = wlist[j];

        if (t.isWhileKeyword && j!==start) {
          // note: _only_ possible loop at this point is a regular `while`
          foundYield = processSlice(j, t.stmtEnd.white, t.black) || foundYield;
          j = t.stmtEnd.white-1;
          continue;
        }

        // TODO: function declarations have the same hoisting problem, require rewrite too
        if (t.isVarKeyword) {
          vars.push.apply(vars, t.vars);
          t.value = '';
        }

        var wasYield = false;

        funcs.forEach(function(o,index){
          var fx = o.output;
          if (j < o.stmtStart) {
            // ignore
          } else if (j===o.stmtStart) {
            foundYield = true;
            wasYield = true;

            getStatementOfYield(wlist, blist, o, f0, fx, index);
          } else if (j>=o.stmtEnd) {
            if (whiling && t.isBreakKeyword) {
              fx.push('{',prefix,'broke_',whiling,' = true;\nbreak;\n}');
            } else if (whiling && t.isContinueKeyword) {
              fx.push('break;');
//            } else if (t.yieldStatementStart) {
//              fx.push(t.yieldStatementStart.returnCode);
            } else if (t.inYieldStmt === undefined || t.inYieldStmt <= index || t.isYield) {
              fx.push(t.value);
            }
          }
          // else: inside yield statement, but we already cleared that so no need to process
        });

        if (!wasYield && t.inYieldStmt === undefined) {
          // in case of yield, a return is pushed instead
          f0.push(t.value);
        }

        t.value = '';
      }

      if (whiling && foundYield) {
        // there was a while and a yield. fx contains a partial while body.
        // we need to suffix the complete while, again, to make sure the
        // original code semantics are preserved. we'll prefix this with
        // a condition that checks whether a `break` occurred in the
        // partial body. We need not worry about `continue` here.

        // this is probably incorrect for multiple yields in the same function
        funcs.forEach(function(o, index){
          o.output.push(
            'if (!',prefix,'broke_',whiling,') { ',
            f0.slice(out0point).join(''),
            '}'
          );
        });
      }

      return foundYield;
    }

    processSlice(func.lhc.white+1, func.rhc.white);

    if (vars.length) {
      func.lhc.value += '\nvar '+vars.join(', ')+';\n';
    }

    // yielded: either we track that the function finished, or we track that the function yielded
    // since finished means we have to wrap all return args too, which we already do for yield
    // expressions anyways, we might as well track yields. that way we can leave return alone :)

    func.lhc.value += ('\n'+
      '\t\tvar '+prefix+'that = this;\n' +
      '\t\tvar '+prefix+'ielded = true;\n' +
      '\t\tvar '+prefix+'nextId = 0;\n'+
      '\t\tvar '+funcs.map(function(o){ return prefix+'ieldValue_'+o.id; }).join(', ')+';\n\n'+
      (statementVars.length?('\t\tvar ' + statementVars.join(', ') + ';\n\n'):'') +
      '\t\tvar '+prefix+'funcs = [\n'+
      '\t\t\tfunction '+prefix+'f0(){\n'+prefix+'ielded=false;\n'+f0.join('')+'\n\t\t\t}\n\t\t];\n\n' +
      funcs.map(function(o){
        return '\t\t'+prefix+'funcs['+o.id+'] = function '+prefix+'f'+o.id+'('+prefix+'ieldValue){console.log('+ o.id+', '+prefix+'ieldValue);\n'+
          prefix+'ieldValue_'+o.id+' = '+prefix+'ieldValue;\n'+
          prefix+'ielded=false;\n'+
          o.init+'\n'+
          o.output.join('')+'\n' +
          '\t\t};';
      }).join('\n\n')+'\n\n'+
      '\t\treturn {\n' +
      '\t\t\tnext: function(v){\n' +
      '\t\t\t\tif (arguments.length > 1) throw "next() only accepts zero or one arguments...";\n'+
      '\t\t\t\tif (!'+prefix+'ielded) throw \'unable to next, iterator finished\';\n' +
      '\t\t\t\treturn {' +
        'value:'+prefix+'funcs['+prefix+'nextId].call('+prefix+'that, v), ' +
        prefix+'ielded: '+prefix+'ielded,'+
        prefix+'nextId: '+prefix+'nextId,'+
        'done:!'+prefix+'ielded' +
      '};\n' +
      '\t\t\t},\n' +
      '\t\t};\n'
      ).replace(/\t/g,'  ');

  }


  return p.tok.tokens.map(function(o){ return o.value; }).join('')//+'f=g();console.log(f.next());console.log(f.next());console.log(f.next());'
}

function getStatementOfYield(wlist, blist, yfuncDetails, f0, fx, yieldIndex) {
  var slice = wlist.slice(yfuncDetails.stmtStart, yfuncDetails.stmtEnd);
  var rhpWhite = wlist[yfuncDetails.stmtStart].rhp && wlist[yfuncDetails.stmtStart].rhp.white;

  if(1) fx.push.apply(fx, slice.map(function(o,i){
    if (o.isYield) {
      if (o.yieldId <= yfuncDetails.id) {
        f0.push(o.returnCode);
        return o.yieldValueVar;
      }
      return o.returnCode;
    }
    if (o.inYieldStmt && o.inYieldStmt > yfuncDetails.id) return '';
    return o.value;
  }));
}
