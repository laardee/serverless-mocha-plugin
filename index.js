'use strict';

/**
 * serverless-mocha-plugin
 * - a plugin for TDD with serverless
 */

const path = require('path');
const fs = require('fs');
const lambdaWrapper = require('lambda-wrapper');
const Mocha = require('mocha');
const chai = require('chai');
const ejs = require('ejs');
const utils = require('./utils.js');
const Promise = require('bluebird');

// const testFolder = 'test'; // Folder used my mocha for tests
const templateFilename = 'sls-mocha-plugin-template.ejs';

class mochaPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      create: {
        usage: 'Create mocha tests for service / function',
        commands: {
          test: {
            usage: 'Create test',
            lifecycleEvents: [
              'test'
            ],
            options: {
              function: {
                usage: 'Name of the function',
                shortcut: 'f',
                required: true,
              }
            }
          }
        }
      },
      invoke: {
        usage: 'Invoke mocha tests for service / function',
        commands: {
          test: {
            usage: 'Invoke test(s)',
            lifecycleEvents: [
              'test'
            ],
            options: {
              function: {
                usage: 'Name of the function',
                shortcut: 'f',
                required: false,
              },
              reporter: {
                usage: 'Mocha reporter to use',
                shortcut: 'R',
                required: false
              },
              'reporter-options': {
                usage: 'Options for mocha reporter',
                shortcut: 'O',
                required: false
              }
            }
          }
        }
      }
    };

    this.hooks = {
      'create:test:test': () => {
        Promise.bind(this)
          .then(this.createTest);
      },
      'invoke:test:test': () => {
        Promise.bind(this)
          .then(this.runTests);
      }
    };
  }

  runTests() {
    const that = this;
    const funcName = this.options.f || this.options.function || [];
    const testFileMap = {};
    const mocha = new Mocha({ timeout: 6000 });

    const stage = this.options.stage;
    const region = this.options.region;

    this.serverless.service.load({
      stage,
      region
    })
      .then((inited) => {
        that.serverless.environment = inited.environment;

        that.getFunctions(funcName)
          .then(utils.getTestFiles)
          .then((funcs) => {
            const funcNames = Object.keys(funcs);
            if (funcNames.length === 0) {
              return that.serverless.cli.log('No tests to run');
            }
            funcNames.forEach((func) => {
              that.setEnvVars(func, {
                stage,
                region
              });

              testFileMap[func] = funcs[func];

              mocha.addFile(funcs[func].mochaPlugin.testPath);
            });
            const reporter = that.options.reporter;

            if (reporter !== undefined) {
              const reporterOptions = {};
              if (that.options['reporter-options'] !== undefined) {
                that.options['reporter-options'].split(',').forEach((opt) => {
                  const L = opt.split('=');
                  if (L.length > 2 || L.length === 0) {
                    throw new Error(`invalid reporter option '${opt}'`);
                  } else if (L.length === 2) {
                    reporterOptions[L[0]] = L[1];
                  } else {
                    reporterOptions[L[0]] = true;
                  }
                });
              }
              mocha.reporter(reporter, reporterOptions);
            }

            return mocha.run((failures) => {
              process.on('exit', () => {
                process.exit(failures);  // exit with non-zero status if there were failures
              });
            })
              .on('suite', (suite) => {
                const f = utils.funcNameFromPath(suite.file);
                const func = testFileMap[f];

                if (func) {
                  that.setEnvVars(func, {
                    stage,
                    region
                  });
                }
              })
              .on('end', () => {
              });
          }, error => that.serverless.cli.log(error));
      });
  }

  createTest() {
    const funcName = this.options.f || this.options.function;
    const that = this;

    utils.createTestFolder().then((testFolder) => {
      const testFilePath = utils.getTestFilePath(funcName);
      const func = that.serverless.service.functions[funcName];
      const handlerParts = func.handler.split('.');
      const funcPath = (`${handlerParts[0]}.js`).replace(/\\/g, '/');
      const funcCall = handlerParts[1];

      fs.exists(testFilePath, (exists) => {
        if (exists) {
          that.serverless.cli.log(`Test file ${testFilePath} already exists`)
          return (new Error(`File ${testFilePath} already exists`));
        }

        let templateFilenamePath = path.join(testFolder, templateFilename);
        fs.exists(templateFilenamePath, (templateExists) => {
          if (!templateExists) {
            templateFilenamePath = path.join(__dirname, templateFilename);
          }
          const templateString = utils.getTemplateFromFile(templateFilenamePath);

          const content = ejs.render(templateString, {
            functionName: funcName,
            functionPath: funcPath,
            handlerName: funcCall
          });

          fs.writeFile(testFilePath, content, (err) => {
            if (err) {
              that.serverless.cli.log(`Creating file ${testFilePath} failed: ${err}`);
              return new Error(`Creating file ${testFilePath} failed: ${err}`);
            }
            return that.serverless.cli.log(`serverless-mocha-plugin: created ${testFilePath}`);
          });
        });
      });
    });
  }

  // Helper functions

  getFunctions(funcNames) {
    const that = this;

    return new Promise((resolve, reject) => {
      const funcObjs = {};
      const allFunctions = that.serverless.service.functions;
      const functionNames = typeof (funcNames) === 'string' ? [funcNames] : funcNames;

      if (functionNames.length === 0) {
        return resolve(allFunctions);
      }

      let func;
      functionNames.forEach((funcName) => {
        func = allFunctions[funcName];
        if (func) {
          funcObjs[funcName] = func;
        } else {
          that.serverless.cli.log(`Warning: Could not find function '${funcName}'.`);
        }
      });

      return resolve(funcObjs);
    });
  }

  // SetEnvVars
  setEnvVars(funcName, options) {
    if (this.serverless.environment) {
      utils.setEnv(this.serverless.environment.vars);
      if (options.stage) {
        utils.setEnv(this.serverless.environment.stages[options.stage].vars);
        if (options.region) {
          utils.setEnv(
            this.serverless.environment.stages[options.stage].regions[options.region].vars
          );
        }
      }
    }
  }

}

module.exports = mochaPlugin;
module.exports.lambdaWrapper = lambdaWrapper;
module.exports.chai = chai;
