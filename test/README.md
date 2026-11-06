# Example tests

Offline tests for the examples one folder up. Both halves mock the HTTP layer (a fake `fetch` for Node, a fake `urlopen` for Python), so they prove request shapes, guards, the published webhook signature known answer, and the output the examples print. They do not call the live API.

- `examples.test.mjs`: Node, run with `node --test test/examples.test.mjs`.
- `test-examples.py`: Python standard library, run with `python3 test/test-examples.py`.

`npm test` in the examples folder runs both. The last test in each file checks that no example uses an em dash.
