const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.RateMyAppAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [],
  endpoints: [
    {
      client_method: "NotHappy",
      verb: "POST",
      path: "/ratemyapp/nothappy",
      request_keys: [
        "api",
        "hash",
        "set",
        "email"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.RateMyAppAPI::NotHappy"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<NotHappy>c__AnonStoreyAD::<>m__7B"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "Happy",
      verb: "POST",
      path: "/ratemyapp/happy",
      request_keys: [
        "api",
        "hash",
        "set"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.RateMyAppAPI::Happy"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Happy>c__AnonStoreyAE::<>m__7C"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "RateLater",
      verb: "POST",
      path: "/ratemyapp/rate/later",
      request_keys: [
        "api",
        "hash",
        "set"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.RateMyAppAPI::RateLater"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<RateLater>c__AnonStoreyAF::<>m__7D"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "RateNever",
      verb: "POST",
      path: "/ratemyapp/rate/never",
      request_keys: [
        "api",
        "hash",
        "set"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.RateMyAppAPI::RateNever"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<RateNever>c__AnonStoreyB0::<>m__7E"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "RateComplete",
      verb: "POST",
      path: "/ratemyapp/rate/complete",
      request_keys: [
        "api",
        "hash",
        "set"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.RateMyAppAPI::RateComplete"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<RateComplete>c__AnonStoreyB1::<>m__7F"
          }
        ],
        additional: []
      },
      notes: []
    }
  ]
};

moduleContract.handlers = Object.fromEntries(
  moduleContract.endpoints.map((endpoint) => [
    `${endpoint.verb} ${endpoint.path}`,
    createUnknownStub(moduleContract.client_type, endpoint)
  ])
);

module.exports = moduleContract;
