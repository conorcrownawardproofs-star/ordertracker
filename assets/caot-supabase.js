/* Cloud layer for Award Order Tracker. No-ops until supabase-config.js is filled. */
(function (w) {
  "use strict";
  var cfg = w.CAOT_SUPABASE || {};
  var enabled = !!(w.supabase && cfg.url && cfg.anonKey &&
    cfg.url.indexOf("YOUR-PROJECT") === -1 &&
    cfg.anonKey.indexOf("YOUR-ANON") === -1);
  var client = null;
  if (enabled) {
    client = w.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
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
      createdAt: r.created_at || "",
      updatedAt: r.updated_at || ""
    };
  }
  function asUser(session, username) {
    var u = session.user;
    return {
      key: u.id,
      username: username || (u.user_metadata && u.user_metadata.username) || (u.email || "").split("@")[0],
      email: u.email || "",
      cloud: true,
      tokenVersion: 1
    };
  }

  w.CAOTCloud = {
    enabled: function () { return enabled; },
    client: function () { return client; },
    signIn: function (email, password) {
      return client.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return asUser(res.data.session);
        });
    },
    signUp: function (email, password, username) {
      return client.auth.signUp({
        email: email,
        password: password,
        options: { data: { username: username } }
      }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        if (!res.data.session) {
          throw new Error("Check your email to confirm the account, then sign in.");
        }
        return asUser(res.data.session, username);
      });
    },
    sessionUser: function () {
      return client.auth.getSession().then(function (res) {
        var s = res.data && res.data.session;
        return s ? asUser(s) : null;
      });
    },
    signOut: function () {
      return client.auth.signOut();
    },
    pull: function () {
      return client.from("orders").select("*").then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return (res.data || []).map(fromRow);
      });
    },
    pushAll: function (userId, orders, deleted) {
      var upserts = (orders || []).map(function (o) { return toRow(userId, o); });
      var chain = Promise.resolve();
      if (upserts.length) {
        chain = client.from("orders").upsert(upserts, { onConflict: "id" }).then(function (res) {
          if (res.error) throw new Error(res.error.message);
        });
      }
      var gone = Object.keys(deleted || {});
      if (gone.length) {
        chain = chain.then(function () {
          return client.from("orders").delete().in("id", gone);
        }).then(function (res) {
          if (res.error) throw new Error(res.error.message);
        });
      }
      return chain;
    }
  };
})(window);
