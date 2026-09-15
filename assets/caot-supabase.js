/* Cloud layer — plain fetch only. Does not use supabase-js. */
(function (w) {
  "use strict";
  var cfg = w.CAOT_SUPABASE || {};
  var origin = String(cfg.url || "").replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  var enabled = !!(origin && cfg.anonKey &&
    origin.indexOf("YOUR-PROJECT") === -1 &&
    String(cfg.anonKey).indexOf("YOUR-ANON") === -1);
  var SESSION_KEY = "caot_cloud_session_v1";

  function saveSession(data) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user,
      expires_at: data.expires_at || (data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : 0),
      savedAt: Date.now()
    })); } catch (e) {}
  }
  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch (e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function asUser(u, username) {
    if (!u) return null;
    return {
      key: u.id,
      username: username || (u.user_metadata && u.user_metadata.username) || (u.email || "").split("@")[0],
      email: u.email || "",
      cloud: true,
      tokenVersion: 1
    };
  }
  function token() {
    var s = readSession();
    return (s && s.access_token) || cfg.anonKey;
  }
  /* Access tokens expire after about an hour. Refresh a bit before that, and
     share one in-flight refresh between concurrent requests. */
  var refreshing = null;
  function refresh() {
    var s = readSession();
    if (!s || !s.refresh_token) return Promise.resolve(false);
    if (refreshing) return refreshing;
    refreshing = fetch(origin + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && data.access_token) { saveSession(data); return true; }
        return false;
      });
    }).catch(function () { return false; })
      .then(function (ok) { refreshing = null; return ok; });
    return refreshing;
  }
  function ensureFresh() {
    var s = readSession();
    if (!s || !s.refresh_token) return Promise.resolve();
    var exp = s.expires_at || 0;
    if (exp && exp - Math.floor(Date.now() / 1000) > 60) return Promise.resolve();
    return refresh();
  }
  function jsonHeaders(useUserToken) {
    var t = useUserToken ? token() : cfg.anonKey;
    return {
      apikey: cfg.anonKey,
      Authorization: "Bearer " + t,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
  }
  function parseErr(data, status) {
    if (!data) return "Request failed (" + status + ")";
    return data.error_description || data.msg || data.message || data.error ||
      data.hint || ("Request failed (" + status + ")");
  }
  function req(path, opts, retried) {
    opts = opts || {};
    var useUser = opts.auth !== false;
    return (useUser ? ensureFresh() : Promise.resolve()).then(function () {
      var h = jsonHeaders(useUser);
      if (opts.prefer) h.Prefer = opts.prefer;
      return fetch(origin + path, {
        method: opts.method || "GET",
        headers: h,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    }).then(function (res) {
      if (res.status === 401 && useUser && !retried) {
        return refresh().then(function (ok) {
          if (ok) return req(path, opts, true);
          return res.text().then(function () { throw new Error("Your cloud session expired. Sign out and back in."); });
        });
      }
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { message: text }; }
        if (!res.ok) throw new Error(parseErr(data, res.status));
        return data;
      });
    });
  }
  function toRow(userId, o) {
    return {
      id: o.id,
      user_id: userId,
      date: o.date || null,
      seq: o.seq || 0,
      order_id: o.orderId || "",
      customer: o.customer || "",
      placed_date: o.placedDate || null,
      req_ship_date: o.reqShipDate || null,
      event_date: o.eventDate || null,
      otype: o.otype || "",
      qty: o.qty === "" || o.qty == null ? null : String(o.qty),
      amount: o.amount === "" || o.amount == null ? null : String(o.amount),
      proof: o.proof || "",
      marking: o.marking || "NONE",
      status: o.status || "",
      status_log: o.statusLog || [],
      start_time: o.startTime || "",
      completion_time: o.completionTime || "",
      proof_rcvd_time: o.proofRcvdTime || "",
      fin: o.fin || "",
      saved_to_drive: o.savedToDrive || "",
      held: o.held || "FALSE",
      notes: o.notes || "",
      proofs: o.proofs || [],
      created_at: o.createdAt || new Date().toISOString(),
      updated_at: o.updatedAt || new Date().toISOString()
    };
  }
  function fromRow(r) {
    return {
      id: r.id,
      date: r.date || "",
      seq: r.seq || 0,
      orderId: r.order_id || "",
      customer: r.customer || "",
      placedDate: r.placed_date || "",
      reqShipDate: r.req_ship_date || "",
      eventDate: r.event_date || "",
      otype: r.otype || "",
      qty: r.qty == null ? "" : r.qty,
      amount: r.amount == null ? "" : r.amount,
      proof: r.proof || "X",
      marking: r.marking || "NONE",
      status: r.status || "",
      statusLog: r.status_log || [],
      startTime: r.start_time || "",
      completionTime: r.completion_time || "",
      proofRcvdTime: r.proof_rcvd_time || "",
      fin: r.fin || "X",
      savedToDrive: r.saved_to_drive || "X",
      held: r.held || "FALSE",
      notes: r.notes || "",
      proofs: Array.isArray(r.proofs) ? r.proofs : [],
      createdAt: r.created_at || "",
      updatedAt: r.updated_at || ""
    };
  }

  w.CAOTCloud = {
    enabled: function () { return enabled; },
    signIn: function (email, password) {
      return req("/auth/v1/token?grant_type=password", {
        method: "POST",
        auth: false,
        body: { email: email, password: password }
      }).then(function (data) {
        if (!data.access_token) throw new Error("Sign in did not return a session.");
        saveSession(data);
        return asUser(data.user);
      });
    },
    signUp: function (email, password, username) {
      return req("/auth/v1/signup", {
        method: "POST",
        auth: false,
        body: { email: email, password: password, data: { username: username || "" } }
      }).then(function (data) {
        if (!data.access_token) {
          throw new Error("Account created. Confirm the email, then sign in.");
        }
        saveSession(data);
        return asUser(data.user, username);
      });
    },
    sessionUser: function () {
      var s = readSession();
      if (!s || !s.user) return Promise.resolve(null);
      return Promise.resolve(asUser(s.user));
    },
    signOut: function () { clearSession(); return Promise.resolve(); },
    pull: function () {
      return req("/rest/v1/orders?select=*", { method: "GET" }).then(function (rows) {
        return (Array.isArray(rows) ? rows : []).map(fromRow);
      });
    },
    pushAll: function (userId, orders, deleted) {
      var upserts = (orders || []).map(function (o) { return toRow(userId, o); });
      var chain = Promise.resolve();
      if (upserts.length) {
        chain = req("/rest/v1/orders?on_conflict=id", {
          method: "POST",
          body: upserts,
          prefer: "resolution=merge-duplicates,return=minimal"
        }).catch(function (err) {
          /* Prefer header-based upsert */
          return fetch(origin + "/rest/v1/orders", {
            method: "POST",
            headers: Object.assign(jsonHeaders(true), {
              Prefer: "resolution=merge-duplicates,return=minimal"
            }),
            body: JSON.stringify(upserts)
          }).then(function (res) {
            return res.text().then(function (text) {
              if (!res.ok) {
                var data = {};
                try { data = text ? JSON.parse(text) : {}; } catch (e) {}
                throw new Error(parseErr(data, res.status) || err.message);
              }
            });
          });
        });
      }
      var gone = Object.keys(deleted || {});
      if (gone.length) {
        chain = chain.then(function () {
          var list = gone.map(function (id) { return '"' + String(id).replace(/"/g, "") + '"'; }).join(",");
          return req("/rest/v1/orders?id=in.(" + encodeURIComponent(list) + ")", { method: "DELETE", prefer: "return=minimal" });
        });
      }
      return chain;
    },
    loadAvatar: function (userId) {
      return req("/rest/v1/profiles?id=eq." + encodeURIComponent(userId) + "&select=avatar", { method: "GET" })
        .then(function (rows) {
          return rows && rows[0] ? rows[0].avatar : "";
        }).catch(function () { return ""; });
    },
    uploadProof: function (userId, orderId, fileId, file) {
      var path = userId + "/" + orderId + "/" + fileId + ".pdf";
      return ensureFresh().then(function () { return fetch(origin + "/storage/v1/object/proofs/" + path, {
        method: "POST",
        headers: {
          apikey: cfg.anonKey,
          Authorization: "Bearer " + token(),
          "Content-Type": file.type || "application/pdf",
          "x-upsert": "true"
        },
        body: file
      }); }).then(function (res) {
        return res.text().then(function (text) {
          if (!res.ok) {
            var data = {};
            try { data = text ? JSON.parse(text) : {}; } catch (e) {}
            throw new Error(parseErr(data, res.status));
          }
          return path;
        });
      });
    },
    signProof: function (path) {
      return req("/storage/v1/object/sign/proofs/" + path, {
        method: "POST",
        body: { expiresIn: 3600 }
      }).then(function (data) {
        var signed = data && (data.signedURL || data.signedUrl);
        if (!signed) throw new Error("Could not open that PDF.");
        if (signed.indexOf("http") === 0) return signed;
        return origin + "/storage/v1" + (signed.charAt(0) === "/" ? signed : "/" + signed);
      });
    },
    deleteProofFile: function (path) {
      return ensureFresh().then(function () { return fetch(origin + "/storage/v1/object/proofs/" + path, {
        method: "DELETE",
        headers: {
          apikey: cfg.anonKey,
          Authorization: "Bearer " + token()
        }
      }); }).then(function () {});
    },
    saveAvatar: function (dataUrl) {
      var s = readSession();
      var id = s && s.user && s.user.id;
      if (!id) return Promise.resolve();
      return req("/rest/v1/profiles?id=eq." + encodeURIComponent(id), {
        method: "PATCH",
        body: { avatar: dataUrl }
      }).then(function (rows) {
        if (Array.isArray(rows) && rows.length) return;
        return req("/rest/v1/profiles?on_conflict=id", {
          method: "POST",
          body: { id: id, avatar: dataUrl },
          prefer: "resolution=merge-duplicates,return=minimal"
        });
      }).catch(function () {
        return req("/rest/v1/profiles", {
          method: "POST",
          body: { id: id, avatar: dataUrl }
        }).catch(function () {});
      });
    }
  };
})(window);
