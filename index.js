var express = require('express'),
  request = require('request'),
  exphbs = require('express-handlebars'),
  logger = require('morgan'),
  cookieParser = require('cookie-parser'),
  bodyParser = require('body-parser'),
  methodOverride = require('method-override'),
  session = require('express-session'),
  passport = require('passport'),
  LocalStrategy = require('passport-local'),
  funct = require('./functions.js'),
  helpers = require('handlebars-helpers'),
  Handlebars = require('handlebars'),
  HandlebarsIntl = require('handlebars-intl'),
  MomentHandler = require('handlebars.moment'),
  _ = require('underscore');
  
const config = require('./config.js');

const developmentMode = process.argv[2] === 'development';


var math = helpers.math();

HandlebarsIntl.registerWith(Handlebars);
MomentHandler.registerHelpers(Handlebars);
Handlebars.registerHelper('eq', function(arg1, arg2, options) {
  return arg1 == arg2 ? options.fn(this) : options.inverse(this);
});
Handlebars.registerHelper('concat', function(arg1, arg2, options) {
  return arg1 + arg2;
});
Handlebars.registerHelper('in', function(elem, list, options) {
  if (list.indexOf(elem) > -1) {
    return options.fn(this);
  }
  return options.inverse(this);
});

var app = express();
var Recaptcha,
    recaptcha;
if (developmentMode) {
  recaptcha = {
    verify: (res, postVerFunction) => postVerFunction(),
    render: () => `<p>DevMode is on, no captcha required.</p>`,

  }
} else {
  Recaptcha = require('express-recaptcha').Recaptcha;
  recaptcha = new Recaptcha(
    config.recaptchaSiteKey,
    config.recaptchaSecretKey
    );
  }

var mongodbUrl = 'mongodb://' + config.mongodbHost + ':27017/users';
var MongoClient = require('mongodb').MongoClient;

var statuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WAITING'];
var count = [0, 0, 0, 0, 0];
var count_pr = [0, 0, 0, 0];

passport.use(
  'local-signin',
  new LocalStrategy({ passReqToCallback: true }, function(
    req,
    username,
    password,
    done
  ) {
    funct
      .localAuth(username, password)
      .then(function(user) {
        if (user) {
          console.log('LOGGED IN AS: ' + user.username, user);
          req.session.success =
            'You are successfully logged in ' + user.username + '!';
          done(null, user);
        }
        if (!user) {
          console.log('COULD NOT LOG IN');
          req.session.error = 'Could not log user in. Please try again.';
          done(null, user);
        }
      })
      .fail(function(err) {
        console.log(err.body);
      });
  })
);

passport.use(
  'local-signup',
  new LocalStrategy({ passReqToCallback: true }, function(
    req,
    username,
    password,
    done
  ) {
    funct
      .localReg(username, password)
      .then(function(user) {
        if (user) {
          console.log('REGISTERED: ' + user.username);
          req.session.success =
            'You are successfully registered and logged in ' +
            user.username +
            '!';
          done(null, user);
        }
        if (!user) {
          console.log('COULD NOT REGISTER');
          req.session.error =
            'That username is already in use, please try a different one.';
          done(null, user);
        }
      })
      .fail(function(err) {
        console.log(err.body);
      });
  })
);
passport.serializeUser(function(user, done) {
  console.log('serializing ' + user.username);
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  MongoClient.connect(
    mongodbUrl,
    function(err, db) {
      db.collection('localUsers').findOne({ username: obj.username }, function(
        err,
        user
      ) {
        done(err, user);
      });
    }
  );
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next(req, res);
  }
  req.session.error = 'Please sign in!';
  res.redirect('/signin');
}
app.use(express.static('public'));
app.use(logger('combined'));
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(methodOverride('X-HTTP-Method-Override'));
app.use(
  session({
    secret: config.sessionSecret,
    saveUninitialized: true,
    resave: true
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
  var err = req.session.error,
    msg = req.session.notice,
    success = req.session.success;

  delete req.session.error;
  delete req.session.success;
  delete req.session.notice;

  if (err) res.locals.error = err;
  if (msg) res.locals.notice = msg;
  if (success) res.locals.success = success;

  next();
});

app.locals.totalSupply = 0;
app.locals.stakingCoins = 0;
var proposals = [];
var paymentRequests = [];
var proposalsMap = {};
var paymentRequestsMap = {};

function getNetworkStats() {
  var urlStakes =
    'https://chainz.cryptoid.info/explorer/index.stakes.dws?coin=nav';
  var urlData = 'https://chainz.cryptoid.info/explorer/index.data.dws?coin=nav';
  var urlProposals =
    'https://testnet.navexplorer.com/api/community-fund/proposal';
  request(
    {
      url: urlData,
      json: true
    },
    function(error, response, body) {
      if (!error && response.statusCode === 200) {
        app.locals.totalSupply = parseFloat(body.blocks[0].out); // Print the json response
        request(
          {
            url: urlStakes,
            json: true
          },
          function(error, response, body) {
            if (!error && response.statusCode === 200) {
              var total = 0;
              for (var s in body.stakes) {
                total += parseFloat(body.stakes[s].amount);
              }
              app.locals.stakingCoins = total;
            }
            request(
              {
                url: urlProposals,
                json: true
              },
              function(error, response, body) {
                if (!error && response.statusCode === 200) {
                  count = [0, 0, 0, 0, 0];
                  count_pr = [0, 0, 0, 0];
                  proposals = body;
                  paymentRequests = [];
                  for (var p in proposals) {
                    if (statuses.indexOf(proposals[p].state) != -1) {
                      count[statuses.indexOf(proposals[p].state)]++;
                    }
                    proposalsMap[proposals[p].hash] = proposals[p];
                    request(
                      {
                        url:
                          'https://testnet.navexplorer.com/api/community-fund/proposal/' +
                          proposals[p].hash +
                          '/payment-request',
                        json: true
                      },
                      function(error, response, body) {
                        if (!error && response.statusCode === 200) {
                          proposalsMap[
                            proposals[p].hash
                          ].payment_requests_count = body.length;
                          proposals[p].payment_requests_count = body.length;
                          for(var pr in body) {
                            funct.addPaymentRequest(body[pr]);
                            paymentRequestsMap[ body[pr].hash ] = body[pr];
                            paymentRequests.push(body[pr]);
                            if (statuses.indexOf(body[pr].state) != -1) {
                              count_pr[statuses.indexOf(body[pr].state)]++;
                            }
                          }
                        }
                      }
                    );
                  }
                }
              }
            );
          }
        );
      }
    }
  );
  setTimeout(getNetworkStats, 300000);
}

getNetworkStats();

var hbs = exphbs.create({
  defaultLayout: 'main'
});
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

app.get('/', function(req, res) {
  var warning = '';
  if (!req.user)
    warning = 'You need to log in to participate in the discussion!';
  else if (!req.user.balance)
    warning =
      'Please, link some staking addresses to your account in order to use the discussion functionality!';
  var f = [];
  var fpr = [];
  for (var c in statuses) {
    if (req.query[statuses[c]] == 'on') f.push(statuses[c]);
    if (req.query[statuses[c] + "_PR"] == 'on') fpr.push(statuses[c]);
  }
console.log(f,fpr);
  f = f.length == 0 ? ['PENDING', 'WAITING'] : f;
  fpr = fpr.length == 0 ? ['PENDING'] : fpr;
  res.render('home', {
    user: req.user,
    proposals: _.sortBy(proposals, 'created_at').reverse(),
    payment_requests: _.sortBy(paymentRequests, 'created_at').reverse(),
    warning: warning,
    filter: f,
    filter_pr: fpr,
    count: count,
    count_pr: count_pr,
    statuses: statuses
  });
});

app.get('/signin', function(req, res) {
  res.render('signin', { captcha: recaptcha.render() });
});

app.get('/register', function(req, res) {
  res.render('register', { captcha: recaptcha.render() });
});

app
  .get('/addresses', function(req, res) {
    ensureAuthenticated(req, res, function(req, res) {
      funct.getAddresses(req.user.username).then(function(a) {
        var warning = '';
        if (req.user && !req.user.balance)
          warning =
            'Please, link some staking addresses to your account in order to use the discussion functionality!';
        res.render('addresses', {
          user: req.user,
          addresses: a,
          salt:
            Math.random()
              .toString(36)
              .substring(2, 15) +
            Math.random()
              .toString(36)
              .substring(2, 15),
          captcha: recaptcha.render(),
          warning: warning
        });
      });
    });
  })
  .post('/addresses', function(req, res) {
    ensureAuthenticated(req, res, function(req, res) {
      funct
        .addAddress(
          req.user.username,
          req.body.address,
          req.body.salt,
          req.body.signature
        )
        .then(function(a) {
          req.session.error = a.err;
          funct.getAddresses(req.user.username).then(function(a) {
            res.redirect('/addresses');
          });
        });
    });
  });

app.get('/delete-address', function(req, res) {
  ensureAuthenticated(req, res, function(req, res) {
    funct
      .deleteAddress(req.user.username, req.param('address'))
      .then(function(a) {
        funct.getAddresses(req.user.username).then(function(a) {
          res.redirect('/addresses');
        });
      });
  });
});

function isValidThread(hash) {
  if (proposalsMap[hash] || paymentRequestsMap[hash]) return true;
  return false;
}

app
  .get('/discussion/:hash', function(req, res) {
    if (isValidThread(req.param('hash'))) {
      funct
        .getDiscussion(req.param('hash'), app.locals.stakingCoins)
        .then(function(m) {
          var warning = '';
          if (!req.user)
            warning = 'You need to log in to participate in the discussion!';
          else if (!req.user.balance)
            warning =
              'Please, link some staking addresses to your account in order to use the discussion functionality!';
          res.render('discussion', {
            user: req.user,
            proposal: proposalsMap[req.param('hash')] ? proposalsMap[req.param('hash')] : proposalsMap[paymentRequestsMap[req.param('hash')].proposal_hash],
            payment_request: paymentRequestsMap[req.param('hash')],
            messages: m,
            captcha: recaptcha.render(),
            warning: warning,
            hash: req.param('hash'),
            is_proposal: proposalsMap[req.param('hash')] ? true : false,
          });
        });
    } else {
      req.session.notice = 'Unknown proposal ' + req.param('hash') + '!';
      res.redirect('/');
    }
  })
  .post('/discussion/:hash', function(req, res) {
    ensureAuthenticated(req, res, function(req, res) {
      if (isValidThread(req.param('hash'))) {
        if (!req.user.balance) {
          res.redirect('/discussion/' + req.param('hash'));
        } else {
          funct
            .addComment(req.param('hash'), req.user.username, req.body.comment)
            .then(function(m) {
              res.redirect('/discussion/' + req.param('hash'));
            });
        }
      } else {
        req.session.notice = 'Unknown proposal ' + req.param('hash') + '!';
        res.redirect('/');
      }
    });
  });

app.post('/local-reg', function(req, res) {
  recaptcha.verify(req, function(error, data) {
    if (!error)
      passport.authenticate('local-signup', {
        successRedirect: '/',
        failureRedirect: '/register'
      })(req, res);
    else {
      req.session.notice = 'Wrong captcha!';
      res.redirect('/register');
    }
  });
});

app.post('/login', function(req, res) {
  recaptcha.verify(req, function(error, data) {
    if (!error)
      passport.authenticate('local-signin', {
        successRedirect: '/',
        failureRedirect: '/signin'
      })(req, res);
    else {
      req.session.notice = 'Wrong captcha!';
      res.redirect('/signin');
    }
  });
});

app.get('/logout', function(req, res) {
  var name = req.user ? req.user.username : 'Unknown';
  req.logout();
  res.redirect('/');
  req.session.notice = 'You have successfully been logged out ' + name + '!';
});

var port = process.env.PORT || 5000;
app.listen(port);

if (developmentMode)
  console.log("Running in Devopment Mode.", "Captcha is disabled.");

console.log('Listening on `localhost:' + port + '`!');
