# Phase 15 — Airbyte Ingestion Tooling (Self-Hosted)

**Goal:** Deploy Airbyte so it's ready to use when a non-Sheets data source is needed. No pipelines are built in this phase — this is infrastructure-only.

**Prerequisites:**
- Phase 9 complete — ECS Fargate set up
- Phase 1 complete — EC2 access (Airbyte is heavier than the standard ECS Fargate task size and benefits from a persistent EBS volume; EC2 is preferred for the platform itself)

---

## 1. Why Airbyte

Airbyte is the default ingestion tool for pulling from supported SaaS systems (Salesforce, HubSpot, Jira, etc.) into Postgres or a data warehouse. The custom connectors in this repo (Aplos, Slack) are built by hand because Airbyte doesn't have native connectors for these. Airbyte becomes valuable when a client uses a mainstream SaaS that Airbyte already supports.

For V1 (Launchpad internal), Airbyte is not used yet. This phase sets up the infrastructure so it's ready.

---

## 2. Deploy Airbyte on EC2

Airbyte recommends at least a `t3.medium` (2 vCPU, 4 GB RAM).

```bash
# Launch EC2 instance
aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t3.medium \
  --key-name <your-key-pair> \
  --security-group-ids <sg-id-that-allows-SSH-and-port-8000> \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=lp-airbyte}]'
```

SSH into the instance:
```bash
ssh -i ~/.ssh/<key>.pem ec2-user@<public-ip>
```

Install Airbyte:
```bash
sudo yum update -y
sudo yum install -y docker git
sudo systemctl start docker
sudo usermod -aG docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Airbyte
mkdir ~/airbyte && cd ~/airbyte
wget https://raw.githubusercontent.com/airbytehq/airbyte/master/run-ab-platform.sh
chmod +x run-ab-platform.sh
./run-ab-platform.sh
```

Access Airbyte at `http://<ec2-public-ip>:8000` (default credentials: `airbyte` / `password` — change immediately).

---

## 3. Configure the destination

Add the LP Internal RDS as a destination:

1. **Destinations → New destination → Postgres**
2. Host: `<rds-host>`
3. Port: `5432`
4. Database: `lpinternal`
5. Username: `lpapp`
6. Password: `<lpapp-password>`
7. SSL: Required
8. Schema: `airbyte_raw` (Airbyte writes raw data to a staging schema; you transform from there)

---

## 4. Document when to use Airbyte vs custom connectors

| Use Airbyte when | Use custom connector when |
|---|---|
| Source has a native Airbyte connector | Source has no Airbyte connector |
| High data volume (millions of rows) | Small/medium dataset |
| Schema changes frequently | Schema is stable and well-understood |
| Client manages the source system | You control the data shape |

Current connectors that should stay custom: Aplos, Slack.

---

## 5. Restrict access

Airbyte should not be publicly accessible. Options:
- Use an EC2 security group that only allows inbound on port 8000 from your office IP
- Set up an SSH tunnel for local access: `ssh -L 8000:localhost:8000 ec2-user@<ip>`

---

## Verification checklist

- [ ] Airbyte running at `http://<ec2-ip>:8000`
- [ ] Admin password changed from default
- [ ] RDS destination configured and connection test passes
- [ ] Access restricted (not publicly open)

---

## When to come back here

Return to this guide and build your first pipeline when:
- A new client uses a SaaS tool that has an Airbyte connector (e.g., Salesforce, HubSpot)
- Data volume from a source makes a custom connector impractical
- A source changes its API frequently and maintenance of a custom connector becomes costly

---

**Next:** [17-aplos-connector.md](17-aplos-connector.md)
