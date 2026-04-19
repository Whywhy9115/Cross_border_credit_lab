# Cross-Border Credit Registry

## Overview

This repository contains a Hardhat prototype for a cross-border credit history system. It implements the smart contract portion of a portable credit record infrastructure for consumers who move between the United States and Canada.

The system uses blockchain to support:

1. A persistent borrower identity across jurisdictions.
2. Permissioned credit record updates by authorized institutions.
3. Append-only credit history, where corrections do not erase prior records.
4. A disputed-record workflow that tracks who opened the dispute, who resolved it, and what correction was appended.

This is a prototype, not a production credit bureau. Sensitive financial data is represented with hashes and `ipfs://`-style metadata references instead of being stored directly on-chain.

## Repository Contents

- `contracts/CrossBorderCreditRegistry.sol`: Solidity contract for borrowers, institutions, records, disputes, and corrections.
- `scripts/runDemo.js`: Complete local scenario that deploys the contract and executes the main workflow.
- `scripts/showState.js`: Small state-inspection script for showing borrower record history.
- `test/CrossBorderCreditRegistry.js`: Automated tests proving the main contract rules.

## How To Run

Clone the repository:

```bash
git clone https://github.com/Whywhy9115/Cross_border_credit_lab.git
cd Cross_border_credit_lab
```

Install dependencies:

```bash
npm install
```

Compile the smart contract:

```bash
npm run compile
```

Run the full scenario:

```bash
npm run demo
```

Run the state-inspection script:

```bash
npm run state
```

Run the tests:

```bash
npm test
```

## System Scenario

The main command is:

```bash
npm run demo
```

The script deploys a fresh local contract and uses Hardhat accounts for five roles:

- Regulator: owns the registry and authorizes institutions.
- Maple Bank: an authorized Canadian institution.
- Steel City Credit Union: an authorized United States institution.
- Alice: a borrower with one portable blockchain identity.
- Attacker: an unauthorized account used to prove access control works.

The scenario includes these steps:

1. The regulator authorizes Maple Bank and Steel City Credit Union.
2. Alice registers one portable borrower identity hash.
3. Maple Bank submits a Canadian loan repayment record for Alice.
4. Alice disputes that record.
5. Maple Bank resolves the dispute by appending a correction record.
6. Steel City Credit Union submits a United States credit card payment record for the same Alice identity.
7. An unauthorized account tries to submit a fake record and is blocked by the smart contract.
8. The final output prints Alice's full record history: original Canadian record, correction record, and United States record.

## Contract Interface

Start a local Hardhat console:

```bash
npx hardhat console
```

Deploy the registry:

```javascript
const [regulator, canadaBank, usBank, alice, attacker] = await ethers.getSigners();
const Registry = await ethers.getContractFactory("CrossBorderCreditRegistry");
const registry = await Registry.connect(regulator).deploy();
await registry.waitForDeployment();
await registry.getAddress();
```

Authorize institutions:

```javascript
await registry.authorizeInstitution(canadaBank.address, "Maple Bank", "Canada");
await registry.authorizeInstitution(usBank.address, "Steel City Credit Union", "United States");
```

Register Alice's portable identity:

```javascript
const aliceIdentityHash = ethers.id("did:portable-credit:alice:demo");
await registry.connect(alice).registerBorrower(aliceIdentityHash, "Canada");
```

Submit a Canadian credit record:

```javascript
await registry.connect(canadaBank).submitCreditRecord(alice.address, "loan_repayment", 45, "ipfs://loan-repayment-q1");
```

Open a dispute:

```javascript
await registry.connect(alice).openDispute(1, "ipfs://alice-dispute-wrong-delta");
```

Resolve the dispute by appending a correction:

```javascript
await registry.connect(canadaBank).resolveDispute(
    1,
    true,
    "ipfs://maple-bank-investigation",
    "loan_repayment_corrected",
    60,
    "ipfs://loan-repayment-q1-corrected");
```

Submit a United States credit record for the same borrower:

```javascript
await registry.connect(usBank).submitCreditRecord(alice.address, "credit_card_on_time_payment", 15, "ipfs://us-card-payment-april");
```

Read Alice's full record history:

```javascript
const recordIds = await registry.getBorrowerRecordIds(alice.address);
recordIds.map((id) => id.toString());
```

Inspect one record:

```javascript
await registry.getCreditRecord(1);
```

Try an unauthorized write:

```javascript
await registry.connect(attacker).submitCreditRecord(alice.address, "fake_record", -100, "ipfs://fake");
```

That transaction reverts with:

```text
only authorized institution
```

## System Design

The economic problem is credit portability. A person with strong credit history can become credit invisible after moving across a national border because credit systems are fragmented.

The blockchain design provides:

- The borrower identity persists across jurisdictions.
- Only approved institutions can write records.
- Each write is tied to the institution address that created it.
- Disputes are visible in the shared ledger.
- Corrections are appended as new records, preserving the original report and the correction trail.

The main contract components are:

- `Institution`: tracks authorized writers and their jurisdictions.
- `Borrower`: stores the portable identity hash.
- `CreditRecord`: stores credit events and links corrections with `previousRecordId`.
- `Dispute`: stores the dispute reason, evidence hash, status, and correction record id.
- `onlyOwner`: limits institution authorization to the regulator.
- `onlyActiveInstitution`: prevents unauthorized credit record updates.

## Runtime Output

`npm run demo` prints:

- The deployed contract address.
- The regulator, institution, borrower, and attacker addresses.
- Alice's identity hash.
- The original Canadian credit record.
- The disputed flag after Alice opens the dispute.
- The correction record with `previousRecordId: 1`.
- The United States credit record.
- A failed unauthorized write with `only authorized institution`.
- Final borrower history containing record ids `1, 2, 3`.

## Design Notes

Personal financial documents are not stored directly on-chain. The demo stores hashes and metadata references because real credit records require privacy-preserving storage and access controls.

Corrections are append-only. The original record stays visible, and the correction record links back to it through `previousRecordId`.

Only the institution that created a disputed record can resolve that dispute. This keeps the update trail accountable.

The regulator can deactivate institutions, modeling the permissioned writer requirement for a financial data network.

## Limitations

A production version would need encrypted off-chain evidence storage, privacy-preserving identity, legal compliance across jurisdictions, credit bureau governance, and a real scoring or underwriting layer. This demo focuses only on the smart contract mechanics needed to support portable records and disputed-record corrections.
