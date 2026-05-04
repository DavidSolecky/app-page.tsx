create extension if not exists "uuid-ossp";

create type user_role as enum ('worker','technologist','admin');
create type part_status as enum ('Čaká na pálenie','Vypálené','Obrúsené','Ohnuté','Opracované','Pripravené pre zámočníkov','Problém');
create type approval_status as enum ('Čaká na schválenie','Schválené','Zamietnuté');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'worker',
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default uuid_generate_v4(),
  job_no text unique not null,
  name text not null,
  customer text,
  deadline date,
  created_at timestamptz not null default now()
);

create table assemblies (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid references jobs(id) on delete cascade,
  assembly_no text not null,
  name text not null,
  note text,
  unique(job_id, assembly_no)
);

create table parts (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid references jobs(id) on delete cascade,
  assembly_id uuid references assemblies(id) on delete cascade,
  qr_code text unique not null,
  part_no text not null,
  piece_no integer not null default 1,
  name text not null,
  material text not null,
  thickness numeric not null,
  note text,
  required_final part_status not null default 'Pripravené pre zámočníkov',
  status part_status not null default 'Čaká na pálenie',
  drawing_file text,
  updated_by uuid references profiles(id),
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table part_events (
  id uuid primary key default uuid_generate_v4(),
  part_id uuid references parts(id) on delete cascade,
  old_status part_status,
  new_status part_status not null,
  user_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  note text
);

create table approval_requests (
  id uuid primary key default uuid_generate_v4(),
  request_type text not null,
  target_table text not null,
  target_id uuid not null,
  payload jsonb,
  reason text,
  status approval_status not null default 'Čaká na schválenie',
  requested_by uuid references profiles(id),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table jobs enable row level security;
alter table assemblies enable row level security;
alter table parts enable row level security;
alter table part_events enable row level security;
alter table approval_requests enable row level security;

create policy "read profiles" on profiles for select using (auth.uid() is not null);
create policy "read jobs" on jobs for select using (auth.uid() is not null);
create policy "read assemblies" on assemblies for select using (auth.uid() is not null);
create policy "read parts" on parts for select using (auth.uid() is not null);
create policy "read events" on part_events for select using (auth.uid() is not null);
create policy "read approvals" on approval_requests for select using (auth.uid() is not null);

create policy "technologist admin create jobs" on jobs for insert with check ((select role from profiles where id = auth.uid()) in ('technologist','admin'));
create policy "technologist admin create assemblies" on assemblies for insert with check ((select role from profiles where id = auth.uid()) in ('technologist','admin'));
create policy "technologist admin create parts" on parts for insert with check ((select role from profiles where id = auth.uid()) in ('technologist','admin'));

create policy "workers update part status" on parts for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "create events" on part_events for insert with check (auth.uid() is not null);
create policy "create approval request" on approval_requests for insert with check ((select role from profiles where id = auth.uid()) in ('technologist','admin'));
create policy "admin update approval" on approval_requests for update using ((select role from profiles where id = auth.uid()) = 'admin');
create policy "admin delete jobs" on jobs for delete using ((select role from profiles where id = auth.uid()) = 'admin');
create policy "admin delete assemblies" on assemblies for delete using ((select role from profiles where id = auth.uid()) = 'admin');
create policy "admin delete parts" on parts for delete using ((select role from profiles where id = auth.uid()) = 'admin');

insert into jobs (job_no, name, customer) values ('2026-015', 'SHARK M1', 'Interná výroba');
insert into assemblies (job_id, assembly_no, name, note)
select id, 'RAM', 'Rám', 'Základná zváraná zostava' from jobs where job_no='2026-015';
insert into assemblies (job_id, assembly_no, name, note)
select id, 'NAS', 'Násypka', 'Plechové diely na ohyb' from jobs where job_no='2026-015';
insert into parts (job_id, assembly_id, qr_code, part_no, piece_no, name, material, thickness, note, required_final, status)
select j.id, a.id, '2026-015-RAM-001-01', 'RAM-001', 1, 'Bočnica rámu', 'S355', 10, 'OHÝBAŤ', 'Ohnuté', 'Vypálené'
from jobs j join assemblies a on a.job_id=j.id and a.assembly_no='RAM' where j.job_no='2026-015';
insert into parts (job_id, assembly_id, qr_code, part_no, piece_no, name, material, thickness, note, required_final, status)
select j.id, a.id, '2026-015-RAM-001-02', 'RAM-001', 2, 'Bočnica rámu', 'S355', 10, 'OHÝBAŤ', 'Ohnuté', 'Čaká na pálenie'
from jobs j join assemblies a on a.job_id=j.id and a.assembly_no='RAM' where j.job_no='2026-015';
