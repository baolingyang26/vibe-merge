import { useState } from 'react';
import type { BranchPeople as BranchPeopleEvidence, GithubAvatar, PersonEvidence } from '../statusTypes';

const scopeLabel = {
  sinceCreation: '建分支后',
  unique: '相对基线独有',
  recent: '最近',
};

const PersonAvatar = ({ person, role, currentGitEmail, avatar }: {
  person: PersonEvidence;
  role: string;
  currentGitEmail: string | null;
  avatar: GithubAvatar | undefined;
}) => {
  const [failed, setFailed] = useState(false);
  const mine = Boolean(currentGitEmail && person.email.toLowerCase() === currentGitEmail.toLowerCase());
  const url = person.avatarUrl ?? avatar?.avatarUrl;
  const title = `${role}：${person.name}${person.commits > 0 ? ` · ${person.commits} 次提交` : ''}${mine ? ' · 与当前 Git 身份一致' : ''}`;
  return <span className={`personAvatar${mine ? ' isMine' : ''}`} title={title} role="img" aria-label={title}>
    {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} referrerPolicy="no-referrer" /> : <span>{person.name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
    {role.startsWith('创建') && <small className="creatorMark">创</small>}
  </span>;
};

export const BranchPeople = ({ people, currentGitEmail, avatars, avatarsByEmail = {} }: {
  people: BranchPeopleEvidence;
  currentGitEmail: string | null;
  avatars: Record<string, GithubAvatar>;
  avatarsByEmail?: Record<string, GithubAvatar>;
}) => {
  const creator = people.creator;
  const creatorContributor = creator && people.contributors.find((person) => person.email.toLowerCase() === creator.email.toLowerCase());
  const others = people.contributors.filter((person) => !creator || person.email.toLowerCase() !== creator.email.toLowerCase());
  const createdByMe = Boolean(currentGitEmail && creator?.email.toLowerCase() === currentGitEmail.toLowerCase());
  const committedByMe = Boolean(currentGitEmail && people.contributors.some((person) => person.email.toLowerCase() === currentGitEmail.toLowerCase()));
  return <div className="branchPeople" role="group" aria-label={`创建者${creator ? creator.name : '未知'}；${scopeLabel[people.scope]}提交者${people.contributors.length}人`}>
    {(createdByMe || committedByMe) && <span className="mineLabel">{createdByMe ? '我创建' : '我提交过'}</span>}
    {creator ? <PersonAvatar person={{ ...creator, commits: creatorContributor?.commits ?? 0 }} role="创建者" currentGitEmail={currentGitEmail} avatar={avatarsByEmail[creator.email.toLowerCase()] ?? (creatorContributor?.sampleSha ? avatars[creatorContributor.sampleSha] : undefined)} />
      : <span className="personAvatar isUnknown" role="img" aria-label="创建者未知" title="本地没有可靠的分支创建记录">?</span>}
    {others.map((person) => <PersonAvatar key={person.email} person={person} role={`${scopeLabel[people.scope]}提交者`} currentGitEmail={currentGitEmail} avatar={person.sampleSha ? avatars[person.sampleSha] : undefined} />)}
    {people.contributors.length === 0 && <span className="peopleEmpty">暂无分支专属提交</span>}
  </div>;
};
