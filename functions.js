var bcrypt = require('bcryptjs'),
    async = require('async'),
    Q = require('q'),
    config = require('./config.js'),
    bitcore = require('bitcore-lib'),
    request = require('request'),
    Message = require('bitcore-message');

var mongodbUrl = 'mongodb://' + config.mongodbHost + ':27017/users';
var MongoClient = require('mongodb').MongoClient

exports.localReg = function (username, password) {
  var deferred = Q.defer();

  MongoClient.connect(mongodbUrl, function (err, db) {
    var collection = db.collection('localUsers');

    collection.findOne({'username' : username})
      .then(function (result) {
        if (null != result) {
          console.log("USERNAME ALREADY EXISTS:", result.username);
          deferred.resolve(false); 
        }
        else  {
          var hash = bcrypt.hashSync(password, 8);
          var user = {
            "username": username,
            "password": hash,
            "balance": 0
          }

          console.log("CREATING USER:", username);

          collection.insert(user)
            .then(function () {
              db.close();
              deferred.resolve(user);
            });
        }
      });
  });

  return deferred.promise;
};


exports.localAuth = function (username, password) {
  var deferred = Q.defer();

  MongoClient.connect(mongodbUrl, function (err, db) {
    var collection = db.collection('localUsers');

    collection.findOne({'username' : username})
      .then(function (result) {
        if (null == result) {
          console.log("USERNAME NOT FOUND:", username);

          deferred.resolve(false);
        }
        else {
          var hash = result.password;

          console.log("FOUND USER: " + result.username);

          if (bcrypt.compareSync(password, hash)) {

            deferred.resolve(result);
          } else {
            console.log("AUTHENTICATION FAILED");
            deferred.resolve(false);
          }
        }

        db.close();
      });
  });

  return deferred.promise;
}

exports.getAddresses = function(username) {
  var deferred = Q.defer();
  MongoClient.connect(mongodbUrl, function (err, db) {
    var collection = db.collection('Addresses');

    var result = collection.find({'username': username}).toArray();
    deferred.resolve(result);
  });
  return deferred.promise;
}

function updateBalance(collection, collectionUsers, username, done){
  var cursor = collection.find({'username': username}).toArray(function (err, result) {
    var balance = 0;
    for (var i in result) {
      balance += result[i].balance;
    }
    collectionUsers.update({username:username},{$set:{balance:balance}}).then(function(err, result) {
      done();
    });
  });
}

exports.getDiscussion = function(hash, stakingCoins) {
  var deferred = Q.defer();
  MongoClient.connect(mongodbUrl, function(err, db) {
    var collection = db.collection('Discussion');
    var collectionUsers = db.collection('localUsers');
    var cursor = collection.find({'hash': hash}).toArray(function (err, results) {
      async.forEachOf(results, function(value,key,callback) {
        collectionUsers.findOne({'username':results[key].username}).then(function (result) {
          if (null != result) results[key].balance = result.balance / stakingCoins;
          callback();
        });
      }, function (err) {
        deferred.resolve(results);
      });
    });
  });
  return deferred.promise;
}

exports.addComment = function(hash, username, comment) {
  var deferred = Q.defer();
  MongoClient.connect(mongodbUrl, function(err, db) {
    var collection = db.collection('Discussion');
    var date = new Date();
    comment = { "hash": hash, "username": username, "type": 0, "comment": comment, "balance": 0, "time": date.getTime()};
    collection.insert(comment)
    .then(function () {
      db.close();
      deferred.resolve(comment);
    });
  });
  return deferred.promise;

}

exports.deleteAddress = function(username,address) {
  var deferred = Q.defer();
  MongoClient.connect(mongodbUrl, function (err, db) {
    var collection = db.collection('Addresses');

    var result = collection.findOneAndDelete({'username': username, 'address': address}).then(function() {
      updateBalance(collection, db.collection('localUsers'),username, function() {
        deferred.resolve(result);
      });
    });
  });
  return deferred.promise;
}

exports.addAddress = function (username, address, salt, signature) {
  var deferred = Q.defer();

  MongoClient.connect(mongodbUrl, function (err, db) {
    var collection = db.collection('Addresses');
    var collectionUsers = db.collection('localUsers');

    //check if address is already assigned in our database
    collection.findOne({'address' : address})
      .then(function (result) {
        if (null != result) {
          console.log("ADDRESS ALREADY EXISTS:", result);
          deferred.resolve({err:"Address already registered",obj:undefined}); // address exists
        }
        else  {
          var verification = false;
          try {
             verification = Message(salt).verify(address, signature);
          } catch(e) {
             deferred.resolve({err:"Error",obj:undefined});
          }
          if(verification) {
             console.log("ADDRESS VERIFIED");
             var url = 'https://chainz.cryptoid.info/explorer/address.summary.dws?coin=nav&id='+address;
             request({
                url: url,
                json: true
             }, function (error, response, body) {
                if (!error && response.statusCode === 200) {
                   if(body.stakeIn > 0 && body.stakeOut > 0) {
                       var addressObj = {
                          "username": username,
                          "address": address,
                          "balance": parseFloat(body.balance)/100000000
                       }
                       collection.insert(addressObj)
                       .then(function () {
                          updateBalance(collection, collectionUsers,username, function() {
                             db.close();
                             deferred.resolve({err:"",obj:addressObj});
                          });
                       });
                   } else {
                      deferred.resolve({err:"Error! Please, try again later",obj:undefined});
                   }
                } else {
                   deferred.resolve({err:"The provided address never staked",obj:undefined});
                }
             });
          } else {
             deferred.resolve({err:"Signature not valid",obj:undefined});
          }
        }
     });
  });

  return deferred.promise;
};
