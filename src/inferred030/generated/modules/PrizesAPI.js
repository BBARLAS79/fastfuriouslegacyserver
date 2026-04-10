const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.PrizesAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [],
  endpoints: [
    {
      client_method: "ClaimPrize",
      verb: "POST",
      path: "/prizes/claim",
      request_keys: [
        "api",
        "id"
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
            function: "EB.Sparx.PrizesAPI::ClaimPrize"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<ClaimPrize>c__AnonStoreyA8::<>m__73"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "ClaimBox",
      verb: "POST",
      path: "/prizes/claimbox/",
      request_keys: [
        "api"
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
            function: "EB.Sparx.PrizesAPI::ClaimBox"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<ClaimBox>c__AnonStoreyA9::<>m__74"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "ClaimAll",
      verb: "POST",
      path: "/prizes/claimall",
      request_keys: [
        "api"
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
            function: "EB.Sparx.PrizesAPI::ClaimAll"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<ClaimAll>c__AnonStoreyAA::<>m__75"
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
