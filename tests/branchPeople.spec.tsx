import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BranchPeople } from '../src/components/branchPeople';
import type { BranchPeople as People } from '../src/statusTypes';

const people: People = {
  creator: { name: 'Alice', email: 'alice@example.test', commits: 0, sampleSha: null, githubLogin: null, avatarUrl: null },
  contributors: [
    { name: 'Alice', email: 'alice@example.test', commits: 2, sampleSha: 'a'.repeat(40), githubLogin: null, avatarUrl: null },
    { name: 'Bob', email: 'bob@example.test', commits: 1, sampleSha: 'b'.repeat(40), githubLogin: null, avatarUrl: null },
  ],
  scope: 'sinceCreation',
};

test('shows each person once with an avatar and hover name only', () => {
  const markup = renderToStaticMarkup(<BranchPeople people={people} avatars={{ ['b'.repeat(40)]: { login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' } }} />);
  expect(markup).toContain('title="Alice"');
  expect(markup).toContain('title="Bob"');
  expect(markup).not.toContain('我创建');
  expect(markup).not.toContain('我提交过');
  expect(markup).not.toContain('creatorMark');
  expect(markup).not.toContain('>创</small>');
  expect(markup).toContain('https://avatars.githubusercontent.com/u/1?v=4');
  expect(markup.match(/class="personAvatar/g)?.length).toBe(2);
});

test('shows known contributors without an unknown creator placeholder', () => {
  const markup = renderToStaticMarkup(<BranchPeople people={{ ...people, creator: null }} avatars={{}} />);
  expect(markup).not.toContain('创建者未知');
  expect(markup.match(/class="personAvatar/g)?.length).toBe(2);
});
