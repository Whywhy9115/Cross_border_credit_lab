// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CrossBorderCreditRegistry {
    enum DisputeStatus {
        None,
        Open,
        ResolvedAccepted,
        ResolvedRejected
    }

    struct Institution {
        bool active;
        string name;
        string jurisdiction;
    }

    struct Borrower {
        bool exists;
        bytes32 identityHash;
        string homeJurisdiction;
    }

    struct CreditRecord {
        uint256 id;
        address borrower;
        address institution;
        string jurisdiction;
        string recordType;
        int256 scoreDelta;
        string metadataHash;
        uint256 previousRecordId;
        bool disputed;
        uint256 createdAt;
    }

    struct Dispute {
        uint256 recordId;
        address openedBy;
        string reasonHash;
        string institutionEvidenceHash;
        DisputeStatus status;
        uint256 correctionRecordId;
    }

    address public owner;
    uint256 public recordCount;

    mapping(address => Institution) public institutions;
    mapping(address => Borrower) public borrowers;
    mapping(uint256 => CreditRecord) private records;
    mapping(uint256 => Dispute) private disputes;
    mapping(address => uint256[]) private borrowerRecordIds;

    event InstitutionAuthorized(address indexed institution, string name, string jurisdiction);
    event InstitutionDeactivated(address indexed institution);
    event BorrowerRegistered(address indexed borrower, bytes32 indexed identityHash, string homeJurisdiction);
    event CreditRecordSubmitted(
        uint256 indexed recordId,
        address indexed borrower,
        address indexed institution,
        uint256 previousRecordId
    );
    event DisputeOpened(uint256 indexed recordId, address indexed borrower, string reasonHash);
    event DisputeResolved(uint256 indexed recordId, DisputeStatus status, uint256 correctionRecordId);

    // Restricts regulator-only actions.
    modifier onlyOwner() {
        require(msg.sender == owner, "only regulator owner");
        _;
    }

    // Restricts credit record writes to approved institutions.
    modifier onlyActiveInstitution() {
        require(institutions[msg.sender].active, "only authorized institution");
        _;
    }

    // Sets the deploying account as the regulator owner.
    constructor() {
        owner = msg.sender;
    }

    // Approves a bank or credit bureau to write credit records.
    function authorizeInstitution(
        address institution,
        string calldata name,
        string calldata jurisdiction
    ) external onlyOwner {
        require(institution != address(0), "institution is zero address");
        require(bytes(name).length > 0, "name required");
        require(bytes(jurisdiction).length > 0, "jurisdiction required");

        institutions[institution] = Institution({
            active: true,
            name: name,
            jurisdiction: jurisdiction
        });

        emit InstitutionAuthorized(institution, name, jurisdiction);
    }

    // Removes an institution's permission to write new records.
    function deactivateInstitution(address institution) external onlyOwner {
        require(institutions[institution].active, "institution not active");
        institutions[institution].active = false;
        emit InstitutionDeactivated(institution);
    }

    // Registers a borrower using a portable identity hash.
    function registerBorrower(bytes32 identityHash, string calldata homeJurisdiction) external {
        require(identityHash != bytes32(0), "identity hash required");
        require(bytes(homeJurisdiction).length > 0, "home jurisdiction required");
        require(!borrowers[msg.sender].exists, "borrower already registered");

        borrowers[msg.sender] = Borrower({
            exists: true,
            identityHash: identityHash,
            homeJurisdiction: homeJurisdiction
        });

        emit BorrowerRegistered(msg.sender, identityHash, homeJurisdiction);
    }

    // Adds a new credit record for a registered borrower.
    function submitCreditRecord(
        address borrower,
        string calldata recordType,
        int256 scoreDelta,
        string calldata metadataHash
    ) external onlyActiveInstitution returns (uint256) {
        require(borrowers[borrower].exists, "borrower not registered");
        require(bytes(recordType).length > 0, "record type required");
        require(bytes(metadataHash).length > 0, "metadata hash required");

        return _appendCreditRecord(
            borrower,
            institutions[msg.sender].jurisdiction,
            recordType,
            scoreDelta,
            metadataHash,
            0
        );
    }

    // Lets the borrower flag one of their records as disputed.
    function openDispute(uint256 recordId, string calldata reasonHash) external {
        CreditRecord storage record = records[recordId];
        require(record.id != 0, "record does not exist");
        require(record.borrower == msg.sender, "only borrower can dispute");
        require(!record.disputed, "record already disputed");
        require(bytes(reasonHash).length > 0, "reason hash required");

        record.disputed = true;
        disputes[recordId] = Dispute({
            recordId: recordId,
            openedBy: msg.sender,
            reasonHash: reasonHash,
            institutionEvidenceHash: "",
            status: DisputeStatus.Open,
            correctionRecordId: 0
        });

        emit DisputeOpened(recordId, msg.sender, reasonHash);
    }

    // Resolves a dispute and optionally appends a correction record.
    function resolveDispute(
        uint256 recordId,
        bool acceptCorrection,
        string calldata institutionEvidenceHash,
        string calldata correctedRecordType,
        int256 correctedScoreDelta,
        string calldata correctedMetadataHash
    ) external onlyActiveInstitution returns (uint256) {
        CreditRecord storage record = records[recordId];
        Dispute storage dispute = disputes[recordId];

        require(record.id != 0, "record does not exist");
        require(record.institution == msg.sender, "only source institution");
        require(dispute.status == DisputeStatus.Open, "dispute not open");
        require(bytes(institutionEvidenceHash).length > 0, "evidence hash required");

        dispute.institutionEvidenceHash = institutionEvidenceHash;

        if (!acceptCorrection) {
            dispute.status = DisputeStatus.ResolvedRejected;
            emit DisputeResolved(recordId, dispute.status, 0);
            return 0;
        }

        require(bytes(correctedRecordType).length > 0, "corrected type required");
        require(bytes(correctedMetadataHash).length > 0, "corrected metadata required");

        uint256 correctionRecordId = _appendCreditRecord(
            record.borrower,
            record.jurisdiction,
            correctedRecordType,
            correctedScoreDelta,
            correctedMetadataHash,
            recordId
        );

        dispute.status = DisputeStatus.ResolvedAccepted;
        dispute.correctionRecordId = correctionRecordId;

        emit DisputeResolved(recordId, dispute.status, correctionRecordId);
        return correctionRecordId;
    }

    // Returns one credit record by id.
    function getCreditRecord(uint256 recordId) external view returns (CreditRecord memory) {
        require(records[recordId].id != 0, "record does not exist");
        return records[recordId];
    }

    // Returns the dispute information for one record.
    function getDispute(uint256 recordId) external view returns (Dispute memory) {
        require(disputes[recordId].recordId != 0, "dispute does not exist");
        return disputes[recordId];
    }

    // Returns every credit record id linked to a borrower.
    function getBorrowerRecordIds(address borrower) external view returns (uint256[] memory) {
        return borrowerRecordIds[borrower];
    }

    // Internal helper that appends records without overwriting history.
    function _appendCreditRecord(
        address borrower,
        string memory jurisdiction,
        string memory recordType,
        int256 scoreDelta,
        string memory metadataHash,
        uint256 previousRecordId
    ) private returns (uint256) {
        recordCount += 1;
        uint256 recordId = recordCount;

        records[recordId] = CreditRecord({
            id: recordId,
            borrower: borrower,
            institution: msg.sender,
            jurisdiction: jurisdiction,
            recordType: recordType,
            scoreDelta: scoreDelta,
            metadataHash: metadataHash,
            previousRecordId: previousRecordId,
            disputed: false,
            createdAt: block.timestamp
        });

        borrowerRecordIds[borrower].push(recordId);
        emit CreditRecordSubmitted(recordId, borrower, msg.sender, previousRecordId);
        return recordId;
    }
}
