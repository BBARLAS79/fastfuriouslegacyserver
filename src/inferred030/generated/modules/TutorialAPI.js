const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.TutorialAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [
    "api"
  ],
  endpoints: [
    {
      client_method: "GetLoginData",
      verb: "POST",
      path: "/tutorial/get-login-data",
      request_keys: [
        "api"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          hashtable: "UNKNOWN"
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.TutorialAPI::GetLoginData"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<GetLoginData>c__AnonStoreyB9::<>m__88"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "StartTutorial",
      verb: "POST",
      path: "/tutorial/start-tutorial",
      request_keys: [
        "api",
        "tid"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          hashtable: "UNKNOWN"
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.TutorialAPI::StartTutorial"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<StartTutorial>c__AnonStoreyBA::<>m__89"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "EarlyStartBranch",
      verb: "POST",
      path: "/tutorial/early-start-branch",
      request_keys: [
        "api",
        "tid",
        "bid"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          hashtable: "UNKNOWN"
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.TutorialAPI::EarlyStartBranch"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<EarlyStartBranch>c__AnonStoreyBB::<>m__8A"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "StartBranch",
      verb: "POST",
      path: "/tutorial/start-branch",
      request_keys: [
        "api",
        "tid",
        "bid"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          hashtable: "UNKNOWN"
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.TutorialAPI::StartBranch"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<StartBranch>c__AnonStoreyBC::<>m__8B"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "CompleteTutorial",
      verb: "POST",
      path: "/tutorial/complete-tutorial",
      request_keys: [
        "api",
        "tid"
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
            function: "EB.Sparx.TutorialAPI::CompleteTutorial"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<CompleteTutorial>c__AnonStoreyBD::<>m__8C"
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
