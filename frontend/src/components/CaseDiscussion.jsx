import { useState } from 'react';
import ManagementEmptyState from './ManagementEmptyState.jsx';

export default function CaseDiscussion({ comments = [], canComment = false, busy = false, onSubmit }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    if (!message.trim()) return;
    setError(null);
    try { if (await onSubmit?.(message.trim()) !== false) setMessage(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Comment could not be saved.'); }
  };
  return <section className="workflow-panel" aria-labelledby="case-discussion-heading">
    <div className="workflow-panel-header"><div><h2 id="case-discussion-heading">Case Discussion</h2><p>Audit-relevant comments are preserved as historical records.</p></div></div>
    {comments.length === 0 ? <ManagementEmptyState title="No case comments have been added." description="Authorized investigators can add notes to the case record." /> : <ol className="case-comments">{comments.map((comment) => <li key={comment.id}><header><strong>{comment.authorName ?? 'Team member'}</strong><span>{comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ''}</span></header><p>{comment.message}</p></li>)}</ol>}
    <form onSubmit={submit}><label className="case-comment-field"><span>Add Comment</span><textarea rows="4" disabled={!canComment || busy} value={message} maxLength={4000} onChange={(event) => setMessage(event.target.value)} placeholder="Add investigation context" /><small>Comments are retained in the case history.</small></label>{error && <p role="alert">{error}</p>}<button type="submit" className="btn btn-secondary" disabled={!canComment || busy || !message.trim()}>{busy ? 'Saving…' : 'Submit Comment'}</button></form>
  </section>;
}
