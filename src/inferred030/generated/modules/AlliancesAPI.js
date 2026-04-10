const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.AlliancesAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [],
  endpoints: [
    {
      client_method: "Refresh",
      verb: "POST",
      path: "/alliances/refresh",
      request_keys: [],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::Refresh"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Refresh>c__AnonStorey60::<>m__25"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "CreateAlliance",
      verb: "POST",
      path: "/alliances/create",
      request_keys: [
        "api",
        "name",
        "tag",
        "msg",
        "pubType",
        "data",
        "gsPrice"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::CreateAlliance"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<CreateAlliance>c__AnonStorey61::<>m__26"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "JoinAlliance",
      verb: "POST",
      path: "/alliances/join",
      request_keys: [
        "api",
        "aid",
        "allowSwitchAlliance"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::JoinAlliance"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<JoinAlliance>c__AnonStorey62::<>m__27"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "LeaveAlliance",
      verb: "POST",
      path: "/alliances/leave",
      request_keys: [
        "api",
        "aid"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::LeaveAlliance"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<LeaveAlliance>c__AnonStorey63::<>m__28"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "UpdateAlliance",
      verb: "POST",
      path: "/alliances/update",
      request_keys: [
        "api",
        "aid",
        "name",
        "tag",
        "msg",
        "pubType",
        "data"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::UpdateAlliance"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<UpdateAlliance>c__AnonStorey64::<>m__29"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "GetAllianceDetails",
      verb: "POST",
      path: "/alliances/details",
      request_keys: [
        "api",
        "aid"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::GetAllianceDetails"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<GetAllianceDetails>c__AnonStorey65::<>m__2A"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "FindAlliances",
      verb: "POST",
      path: "/alliances/find",
      request_keys: [
        "api",
        "name",
        "tag",
        "maxResults",
        "pub",
        "exact",
        "excludeFull"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::FindAlliances"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<FindAlliances>c__AnonStorey66::<>m__2B"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "FindRecommendedAlliances",
      verb: "POST",
      path: "/alliances/find-recommended",
      request_keys: [
        "api",
        "maxResults"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::FindRecommendedAlliances"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<FindRecommendedAlliances>c__AnonStorey67::<>m__2C"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "KickMember",
      verb: "POST",
      path: "/alliances/kick",
      request_keys: [
        "api",
        "aid",
        "targetUid"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::KickMember"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<KickMember>c__AnonStorey68::<>m__2D"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "PromoteMember",
      verb: "POST",
      path: "/alliances/promote",
      request_keys: [
        "api",
        "aid",
        "targetUid",
        "rank"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::PromoteMember"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<PromoteMember>c__AnonStorey69::<>m__2E"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "DemoteMember",
      verb: "POST",
      path: "/alliances/demote",
      request_keys: [
        "api",
        "aid",
        "targetUid",
        "rank"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::DemoteMember"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<DemoteMember>c__AnonStorey6A::<>m__2F"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "AssignOwner",
      verb: "POST",
      path: "/alliances/assignOwner",
      request_keys: [
        "api",
        "aid",
        "targetUid"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::AssignOwner"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<AssignOwner>c__AnonStorey6B::<>m__30"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "InviteJoinAlliance",
      verb: "POST",
      path: "/alliances/invite",
      request_keys: [
        "api",
        "aid",
        "target"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::InviteJoinAlliance"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<InviteJoinAlliance>c__AnonStorey6C::<>m__31"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "RequestJoinAlliance",
      verb: "POST",
      path: "/alliances/request-join",
      request_keys: [
        "api",
        "aid"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::RequestJoinAlliance"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<RequestJoinAlliance>c__AnonStorey6D::<>m__32"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "RequestMembers",
      verb: "POST",
      path: "/alliances/request-members",
      request_keys: [
        "api",
        "aid",
        "request_cat",
        "data"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.error",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AlliancesAPI::RequestMembers"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<RequestMembers>c__AnonStorey6E::<>m__33"
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
