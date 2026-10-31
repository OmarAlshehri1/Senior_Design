import DateTime from './DateTime.jsx';
import { useState } from 'react';
import ManagementEmptyState from './ManagementEmptyState.jsx';
import { Panel } from './ui/Layout.jsx';

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
  return <Panel id="case-discussion-heading" title="Discussion" description="Comments are kept permanently in the case record.">
    {comments.length === 0 ? <ManagementEmptyState title="No comments yet." description="Investigators can add notes to the case record." /> : <ol className="comment-list">{comments.map((comment) => <li key={comment.id}><header><strong>{comment.authorName ?? 'Team member'}</strong><DateTime value={comment.createdAt} /></header><p>{comment.message}</p></li>)}</ol>}
    {canComment && <form className="comment-form" onSubmit={submit}><label className="sr-only" htmlFor="case-comment-input">Add Comment</label><textarea id="case-comment-input" className="input" rows="3" disabled={busy} value={message} maxLength={4000} onChange={(event) => setMessage(event.target.value)} placeholder="Add investigation context" />{error && <p className="inline-alert" role="alert">{error}</p>}<button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !message.trim()}>{busy ? 'Saving…' : 'Add comment'}</button></form>}
  </Panel>;
}
