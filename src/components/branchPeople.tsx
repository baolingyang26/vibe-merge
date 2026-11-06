import { useState } from 'react';
import type { BranchPeople as BranchPeopleEvidence, GithubAvatar, PersonEvidence } from '../statusTypes';

const PersonAvatar = ({ person, avatar }: {
  person: PersonEvidence;
  avatar: GithubAvatar | undefined;
}) => {
  const [failed, setFailed] = useState(false);
  const url = person.avatarUrl ?? avatar?.avatarUrl;
  return <span className="personAvatar" title={person.name} role="img" aria-label={person.name}>
    {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} referrerPolicy="no-referrer" /> : <span>{person.name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
  </span>;
};

export const BranchPeople = ({ people, avatars, avatarsByEmail = {} }: {
  people: BranchPeopleEvidence;
  avatars: Record<string, GithubAvatar>;
  avatarsByEmail?: Record<string, GithubAvatar>;
}) => {
  const creator = people.creator;
  const creatorContributor = creator && people.contributors.find((person) => person.email.toLowerCase() === creator.email.toLowerCase());
  const others = people.contributors.filter((person) => !creator || person.email.toLowerCase() !== creator.email.toLowerCase());
  if (!creator && others.length === 0) return null;
  return <div className="branchPeople" role="group" aria-label="分支成员">
    {creator && <PersonAvatar person={creator} avatar={avatarsByEmail[creator.email.toLowerCase()] ?? (creatorContributor?.sampleSha ? avatars[creatorContributor.sampleSha] : undefined)} />}
    {others.map((person) => <PersonAvatar key={person.email} person={person} avatar={person.sampleSha ? avatars[person.sampleSha] : undefined} />)}
  </div>;
};
