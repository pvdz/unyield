# UnYield

A source code transformation tool to transform so called "generator functions", those are the ones using `yield`, to something that works in ES5.

Usage: Include `unyield.js` and the three files from `lib` in a project. Call `unyield(input);` and it returns you the transformed output.

Mainly a toy project. Probably won't be maintained, mainly a proof of concept "this is how I would do it" etc.

Little effort went into making it look nice. There's some low hanging fruit but output aesthetics were not a goal parameter for this project.

Complete clean-room implementation. I had not looked at Regenerator or how Traceur did this before finishing. It's also based on [ZeParser2](http://github.com/qfox/zeparser2/), which makes the approach inherently different anyways :)

Known limitations:

- finally: screw implementing that. It can be done, not worth my time.
- catch var after yield in catch scope: Yeah like, don't, it won't work :)
- eval: I didn't even bother with the `eval` families
- ASI related issues can pop up. Did not thoroughly test all ASI cases for this project.
- Multiple yields in the same expression won't work. It was too much fiddling to get something like `a(yield)(yield)` or `x = yield + yield` to work. Note that multiple yields in a block or sub-statement should work fine.
- `.throw()`, though this API call can easily be added, good exercise for the reader ;)

You can find a live typing demo at http://unyield.qfox.nl/index.html and the test suite at http://unyield.qfox.nl/tests.html.

I wrote [a blog post](http://qfox.nl/weblog/313) before working on this project. Post mortem blog post coming to a browser near you soon.
