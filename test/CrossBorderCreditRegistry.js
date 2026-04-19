const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossBorderCreditRegistry", function () {
  // Deploys a fresh registry with two approved institutions and one borrower.
  async function deployFixture() {
    const [owner, canadaBank, usBank, alice, attacker] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CrossBorderCreditRegistry");
    const registry = await Registry.connect(owner).deploy();
    await registry.waitForDeployment();

    await registry.authorizeInstitution(canadaBank.address, "Maple Bank", "Canada");
    await registry.authorizeInstitution(usBank.address, "Steel City Credit Union", "United States");
    await registry.connect(alice).registerBorrower(ethers.id("did:portable-credit:alice"), "Canada");

    return { registry, owner, canadaBank, usBank, alice, attacker };
  }

  it("lets only the regulator authorize institutions", async function () {
    const { registry, canadaBank, attacker } = await deployFixture();

    // A non-regulator account cannot approve new institutions.
    await expect(
      registry.connect(attacker).authorizeInstitution(attacker.address, "Fake Bureau", "Nowhere")
    ).to.be.revertedWith("only regulator owner");

    // The regulator-approved institution remains active.
    const institution = await registry.institutions(canadaBank.address);
    expect(institution.active).to.equal(true);
    expect(institution.name).to.equal("Maple Bank");
  });

  it("records cross-border credit events for the same borrower identity", async function () {
    const { registry, canadaBank, usBank, alice } = await deployFixture();

    // Canadian and U.S. institutions can write records for the same borrower.
    await expect(
      registry.connect(canadaBank).submitCreditRecord(alice.address, "loan_repayment", 45, "ipfs://loan-q1")
    ).to.emit(registry, "CreditRecordSubmitted");

    await expect(
      registry.connect(usBank).submitCreditRecord(alice.address, "card_payment", 15, "ipfs://card-april")
    ).to.emit(registry, "CreditRecordSubmitted");

    // The borrower history keeps both cross-border records.
    const ids = await registry.getBorrowerRecordIds(alice.address);
    expect(ids.map((id) => id.toString())).to.deep.equal(["1", "2"]);

    const canadianRecord = await registry.getCreditRecord(1);
    const usRecord = await registry.getCreditRecord(2);
    expect(canadianRecord.jurisdiction).to.equal("Canada");
    expect(usRecord.jurisdiction).to.equal("United States");
  });

  it("blocks unauthorized writers", async function () {
    const { registry, attacker, alice } = await deployFixture();

    // Accounts that are not approved institutions cannot write credit data.
    await expect(
      registry.connect(attacker).submitCreditRecord(alice.address, "fake_record", -100, "ipfs://fake")
    ).to.be.revertedWith("only authorized institution");
  });

  it("opens disputes and appends corrections instead of overwriting records", async function () {
    const { registry, canadaBank, alice } = await deployFixture();

    // Create the original record that Alice will dispute.
    await registry
      .connect(canadaBank)
      .submitCreditRecord(alice.address, "loan_repayment", 45, "ipfs://loan-q1");

    // Alice can dispute her own record.
    await expect(registry.connect(alice).openDispute(1, "ipfs://alice-dispute"))
      .to.emit(registry, "DisputeOpened")
      .withArgs(1, alice.address, "ipfs://alice-dispute");

    // The source institution resolves it by appending a correction.
    await expect(
      registry
        .connect(canadaBank)
        .resolveDispute(
          1,
          true,
          "ipfs://bank-evidence",
          "loan_repayment_corrected",
          60,
          "ipfs://loan-q1-corrected"
        )
    ).to.emit(registry, "DisputeResolved");

    const originalRecord = await registry.getCreditRecord(1);
    const correctionRecord = await registry.getCreditRecord(2);
    const dispute = await registry.getDispute(1);

    // The original remains disputed; the correction points back to it.
    expect(originalRecord.disputed).to.equal(true);
    expect(correctionRecord.previousRecordId).to.equal(1);
    expect(correctionRecord.scoreDelta).to.equal(60);
    expect(dispute.correctionRecordId).to.equal(2);
  });

  it("allows only the source institution to resolve its disputed record", async function () {
    const { registry, canadaBank, usBank, alice } = await deployFixture();

    // Canada bank creates the disputed record.
    await registry
      .connect(canadaBank)
      .submitCreditRecord(alice.address, "loan_repayment", 45, "ipfs://loan-q1");
    await registry.connect(alice).openDispute(1, "ipfs://alice-dispute");

    // A different institution cannot resolve Canada's record.
    await expect(
      registry
        .connect(usBank)
        .resolveDispute(1, true, "ipfs://us-evidence", "wrong_source", 1, "ipfs://wrong")
    ).to.be.revertedWith("only source institution");
  });
});
