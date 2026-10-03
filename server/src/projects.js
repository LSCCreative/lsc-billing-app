'use strict';

const { newId } = require('./db');

/**
 * Projects (v13, production-booking task 15; D31, D60, D61). One project per
 * UPID, holding its estimate (or, for a pair the fix-up kept together, its
 * estimates) and, from task 19, its invoices.
 *
 * THE UPID LIVES ON THE PROJECT. `estimates.upid` is a copy, kept in step on
 * every write for the PDF and anything older that reads it. The one time they
 * differ is a project still waiting for the fix-up screen (needs_upid): its
 * upid is NULL, and each estimate keeps the old shared or blank UPID that the
 * fix-up groups it by.
 *
 * UNIQUE, ignoring case and the spaces round it (D60). A UPID is taken when
 * another project holds it, or when an estimate in another project still
 * carries it while waiting for the fix-up — so a typed UPID can't collide with
 * a group the owner hasn't sorted yet either.
 */

const normUpid = (value) => String(value == null ? '' : value).trim();

/** The project already using `upid`, other than `ownProjectId`; or null. */
function upidTakenBy(db, upid, ownProjectId) {
  if (!upid) return null;
  const row = db.prepare(`
    SELECT id AS project_id FROM projects WHERE upid = @upid AND id <> @own
     UNION ALL
    SELECT project_id FROM estimates
     WHERE lower(trim(upid)) = lower(@upid) AND project_id IS NOT NULL AND project_id <> @own
     LIMIT 1
  `).get({ upid, own: ownProjectId || '' });
  return row ? row.project_id : null;
}

/**
 * The project an estimate write lands in, and the UPID to store on the
 * estimate; or a refusal. `existing` is the estimate row (null for a new one).
 *
 * - A new estimate gets a new project, with the UPID if one was typed.
 * - A project waiting for the fix-up that is saved with the UPID it already
 *   carries stays waiting: saving the editor is not "keep together", and the
 *   UPID is still shared. Any other UPID, if free, settles it.
 * - A UPID another project uses is refused, `upid_taken`.
 *
 * @returns {{status:number, body:object}|{project:object|null, upid:string}}
 */
function planProjectWrite(db, body, existing) {
  const upid = normUpid(body.upid);
  const project = existing && existing.project_id
    ? db.prepare('SELECT * FROM projects WHERE id = ?').get(existing.project_id)
    : null;
  if (project && project.needs_upid === 1 && upid.toLowerCase() === normUpid(existing.upid).toLowerCase()) {
    return { project, upid: existing.upid, unchanged: true };
  }
  const taken = upidTakenBy(db, upid, project && project.id);
  if (taken) {
    return {
      status: 409,
      body: {
        error: 'upid_taken',
        upid,
        projectId: taken,
        message: `${upid} is already used by another project. Each project needs its own UPID.`,
      },
    };
  }
  return { project, upid };
}

/**
 * Applies a plan from planProjectWrite, inside the write's transaction.
 * Returns the project id the estimate belongs to.
 */
function applyProjectWrite(db, plan, clientId, now) {
  if (!plan.project) {
    const id = newId('prj');
    db.prepare(`
      INSERT INTO projects (id, upid, client_id, needs_upid, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(id, plan.upid || null, clientId || null, now, now);
    return id;
  }
  const p = plan.project;
  if (plan.unchanged) {
    db.prepare('UPDATE projects SET client_id = ?, updated_at = ? WHERE id = ?').run(clientId || null, now, p.id);
    return p.id;
  }
  // Clearing the UPID of a project still waiting for the fix-up leaves it
  // waiting; any real UPID settles it.
  db.prepare('UPDATE projects SET upid = ?, needs_upid = ?, client_id = ?, updated_at = ? WHERE id = ?')
    .run(plan.upid || null, plan.upid ? 0 : p.needs_upid, clientId || null, now, p.id);
  db.prepare('UPDATE estimates SET upid = ? WHERE project_id = ? AND upid <> ?').run(plan.upid, p.id, plan.upid);
  return p.id;
}

/** After an estimate is deleted: a project with no estimate left goes too. */
function dropEmptyProject(db, projectId) {
  if (!projectId) return;
  const left = db.prepare('SELECT COUNT(*) AS n FROM estimates WHERE project_id = ?').get(projectId).n;
  if (left === 0) db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
}

module.exports = { normUpid, upidTakenBy, planProjectWrite, applyProjectWrite, dropEmptyProject };
