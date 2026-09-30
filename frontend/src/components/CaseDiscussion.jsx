import ManagementEmptyState from './ManagementEmptyState.jsx';

export default function CaseDiscussion({ comments = [], canComment = false }) {
  return (
    <section className="workflow-panel" aria-labelledby="case-discussion-heading">
      <div className="workflow-panel-header"><div><h2 id="case-discussion-heading">Case Discussion</h2><p>Audit-relevant comments are preserved as historical records.</p></div></div>
      {comments.length === 0 && <ManagementEmptyState title="No case comments are available yet." description="Comments added by authorized investigators will appear here." />}
      <label className="case-comment-field"><span>Add Comment</span><textarea rows="4" disabled={!canComment} placeholder="Add investigation context" /><small>Comment submission is unavailable until the case service is connected.</small></label>
      <button type="button" className="btn btn-secondary" disabled>Submit Comment</button>
    </section>
  );
}
