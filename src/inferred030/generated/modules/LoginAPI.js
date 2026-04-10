const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.LoginAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [
    "platform",
    "device",
    "version",
    "locale",
    "lang",
    "tz"
  ],
  endpoints: [
    {
      client_method: "Init",
      verb: "POST",
      path: "/auth/init",
      request_keys: [
        "platform",
        "device",
        "version",
        "locale",
        "lang",
        "tz"
      ],
      response_contract: {
        success_envelope: "success -> response.result",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          result: "UNKNOWN"
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginAPI::Init"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Init>c__AnonStorey8B::<>m__56"
          }
        ],
        additional: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginManager::Init"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Init>c__AnonStorey119::<>m__101"
          }
        ]
      },
      notes: [
        "Client only checks response.sucessful and forwards response.result to LoginManager._PostInit.",
        "No explicit inner fields are recovered from 0.3.0 client code."
      ]
    },
    {
      client_method: "Enumerate",
      verb: "POST",
      path: "/auth/enumerate",
      request_keys: [
        "auth"
      ],
      response_contract: {
        success_envelope: "success -> response.arrayList",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          "arrayList[]": {
            user: {
              uid: "required",
              name: "optional",
              email: "optional",
              gcid: "optional",
              fbid: "optional",
              cohort: "optional",
              revenue: "optional",
              time_revenue: "optional",
              time_last: "optional",
              level: "optional",
              naid: "optional"
            },
            auth: {
              "<authenticatorName>": {
                id: "required",
                data: "optional object"
              }
            }
          }
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginAPI::Enumerate"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Enumerate>c__AnonStorey8C::<>m__57"
          }
        ],
        additional: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.Account::.ctor"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.UserManager::GetUser"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.User::Update"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AuthData::.ctor"
          }
        ]
      },
      notes: [
        "LoginAPI callback returns response.arrayList.",
        "Each account entry is parsed by EB.Sparx.Account::.ctor.",
        "account.user must be present; UserManager.GetUser searches for uid.",
        "account.auth must be a dictionary keyed by authenticator name."
      ]
    },
    {
      client_method: "PreLogin",
      verb: "POST",
      path: "/auth/prelogin",
      request_keys: [
        "sha1"
      ],
      response_contract: {
        success_envelope: "success -> response.result",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          "result.salt": "required string",
          "result.url": "optional string; if present, client treats it as update-required"
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginAPI::PreLogin"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<PreLogin>c__AnonStorey8D::<>m__58"
          }
        ],
        additional: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginManager::_PreLogin"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<_PreLogin>c__AnonStorey11C::<>m__10B"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<_PreLogin>c__AnonStorey11D::<>m__10C"
          }
        ]
      },
      notes: [
        "Client computes chal locally after receiving salt.",
        "Server does not need to return chal."
      ]
    },
    {
      client_method: "Login",
      verb: "POST",
      path: "/auth/login",
      request_keys: [
        "authenticator",
        "credentials",
        "UNKNOWN(extra login payload)"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          "hashtable.stoken": "required string",
          "hashtable.user": {
            uid: "required",
            name: "optional",
            email: "optional",
            gcid: "optional",
            fbid: "optional",
            cohort: "optional",
            revenue: "optional",
            time_revenue: "optional",
            time_last: "optional",
            level: "optional",
            naid: "optional"
          },
          "hashtable.auth_data": {
            id: "required",
            data: "optional object"
          },
          "hashtable.server_tag": "optional string",
          "hashtable.install": "optional bool"
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginAPI::Login"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Login>c__AnonStorey8E::<>m__59"
          }
        ],
        additional: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Login>c__AnonStorey8E::<>m__59"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<_Login>c__AnonStorey11A::<>m__10A"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.UserManager::GetUser"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.User::Update"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.AuthData::.ctor"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "KabamAuthData::get_Name"
          },
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "KabamAuthData::get_Email"
          }
        ]
      },
      notes: [
        "Client copies stoken into endpoint auth data immediately.",
        "user is resolved through UserManager.GetUser and therefore must contain uid.",
        "auth_data shape is authenticator-specific; only id/data are recoverable at base class level."
      ]
    },
    {
      client_method: "GetLinkedAccounts",
      verb: "GET",
      path: "/account",
      request_keys: [
        "platform",
        "device",
        "version",
        "locale",
        "lang",
        "tz"
      ],
      response_contract: {
        success_envelope: "success -> response.arrayList",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginAPI::GetLinkedAccounts"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<GetLinkedAccounts>c__AnonStorey8F::<>m__5A"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "Unlink",
      verb: "POST",
      path: "/account/unlink",
      request_keys: [
        "platform",
        "device",
        "version",
        "locale",
        "lang",
        "tz",
        "authenticator",
        "aid"
      ],
      response_contract: {
        success_envelope: "success -> no explicit payload",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginAPI::Unlink"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Unlink>c__AnonStorey90::<>m__5B"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "Link",
      verb: "POST",
      path: "/account/link",
      request_keys: [
        "platform",
        "device",
        "version",
        "locale",
        "lang",
        "tz",
        "authenticator",
        "credentials"
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
            function: "EB.Sparx.LoginAPI::Link"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Link>c__AnonStorey91::<>m__5C"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "LoginData",
      verb: "GET",
      path: "/account/data",
      request_keys: [
        "apiversions",
        "nid",
        "ncat",
        "ncta"
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
            function: "EB.Sparx.LoginAPI::LoginData"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<LoginData>c__AnonStorey92::<>m__5D"
          }
        ],
        additional: []
      },
      notes: [
        "The request includes manager api version map and optionally local notification fields.",
        "The response is forwarded as a hashtable; inner shape is not recoverable from LoginAPI alone."
      ]
    },
    {
      client_method: "CheckName",
      verb: "POST",
      path: "/account/check-name",
      request_keys: [
        "platform",
        "device",
        "version",
        "locale",
        "lang",
        "tz",
        "name"
      ],
      response_contract: {
        success_envelope: "success -> no explicit payload",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.LoginAPI::CheckName"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<CheckName>c__AnonStorey93::<>m__5E"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "SetName",
      verb: "POST",
      path: "/account/name",
      request_keys: [
        "platform",
        "device",
        "version",
        "locale",
        "lang",
        "tz",
        "name",
        "assignUnique"
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
            function: "EB.Sparx.LoginAPI::SetName"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<SetName>c__AnonStorey94::<>m__5F"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "GetSupportUrl",
      verb: "GET",
      path: "/account/support",
      request_keys: [
        "platform",
        "device",
        "version",
        "locale",
        "lang",
        "tz"
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
            function: "EB.Sparx.LoginAPI::GetSupportUrl"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<GetSupportUrl>c__AnonStorey95::<>m__60"
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
