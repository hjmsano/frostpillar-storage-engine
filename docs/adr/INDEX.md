# ADR Index

Numbering policy:

- ADR file numbers MUST be unique.
- ADR file numbers MUST be contiguous from `0001` to the latest ADR number.
- `INDEX.md` MUST include exactly one entry per ADR file.

## Core / Architecture

- [0001_CoreBaselineExtraction.md](./0001_CoreBaselineExtraction.md)
- [0009_PublicExport_for_FrostpillarError_Root.md](./0009_PublicExport_for_FrostpillarError_Root.md)
- [0017_StorageSourceResponsibilityLayout.md](./0017_StorageSourceResponsibilityLayout.md)
- [0035_DependencyInjectionTreeShakingStorageDrivers.md](./0035_DependencyInjectionTreeShakingStorageDrivers.md)
- [0046_FrostpillarPackageFamily_and_RuntimeDependencyPolicy.md](./0046_FrostpillarPackageFamily_and_RuntimeDependencyPolicy.md)
- [0048_StorageOperationSurface.md](./0048_StorageOperationSurface.md)
- [0049_StorageEngineBoundary_and_ExternalQueryInterfaceSplit.md](./0049_StorageEngineBoundary_and_ExternalQueryInterfaceSplit.md)
- [0050_BTreeCentric_StorageArchitecture_and_DuplicateKeyPolicy.md](./0050_BTreeCentric_StorageArchitecture_and_DuplicateKeyPolicy.md)
- [0051_RemoveKeyFromPersistedRecord_and_FixSizeEstimation.md](./0051_RemoveKeyFromPersistedRecord_and_FixSizeEstimation.md)
- [0052_CapacityBypass_and_BatchPutMany_Optimization.md](./0052_CapacityBypass_and_BatchPutMany_Optimization.md)
- [0053_SkipPayloadValidation_TrustedInputMode.md](./0053_SkipPayloadValidation_TrustedInputMode.md)
- [0054_HotPathPerformanceOptimizations_P7_P15.md](./0054_HotPathPerformanceOptimizations_P7_P15.md)
- [0055_ContractClarifications_and_DeferredItems.md](./0055_ContractClarifications_and_DeferredItems.md)
- [0056_CountRange_DeleteRebalancePolicy_PopLast.md](./0056_CountRange_DeleteRebalancePolicy_PopLast.md)

## Query

- [0002_QueryResourceGuards_and_PayloadKeyWhitespaceValidation.md](./0002_QueryResourceGuards_and_PayloadKeyWhitespaceValidation.md)
- [0005_QueryFilterTyping_FieldPathEscape_and_AsyncFlowClarity.md](./0005_QueryFilterTyping_FieldPathEscape_and_AsyncFlowClarity.md)
- [0007_QueryFieldOwnPropertyTraversal.md](./0007_QueryFieldOwnPropertyTraversal.md)
- [0008_EagerQueryFieldPathValidation.md](./0008_EagerQueryFieldPathValidation.md)
- [0011_NativeQueryVirtualIdProjectionContract.md](./0011_NativeQueryVirtualIdProjectionContract.md)
- [0024_RegexpSafetySubset_for_QueryBacktrackingDoSGuard.md](./0024_RegexpSafetySubset_for_QueryBacktrackingDoSGuard.md)
- [0027_QueryOutputSerializedCharacterBudgetGuard.md](./0027_QueryOutputSerializedCharacterBudgetGuard.md)
- [0047_NestedPayloadValues_in_DefaultQueryRow.md](./0047_NestedPayloadValues_in_DefaultQueryRow.md)

## Key / Codec / Index

- [0018_ExternalBTreePackageIntegration.md](./0018_ExternalBTreePackageIntegration.md)
- [0019_GenericRecordKeyModel_and_KeyCodecContract.md](./0019_GenericRecordKeyModel_and_KeyCodecContract.md)
- [0020_RecordIdCanonicalSingleSeparatorValidation.md](./0020_RecordIdCanonicalSingleSeparatorValidation.md)
- [0021_RecordIdWriterCanonicalEncodedKeySegments.md](./0021_RecordIdWriterCanonicalEncodedKeySegments.md)
- [0025_ComparatorOutputFiniteIntegerGuard_for_BTreeKeyIndex.md](./0025_ComparatorOutputFiniteIntegerGuard_for_BTreeKeyIndex.md)
- [0026_RecoveryTimeKeyCodecCorruptionGuard.md](./0026_RecoveryTimeKeyCodecCorruptionGuard.md)
- [0028_DefaultStringKeyMode_for_Datastore.md](./0028_DefaultStringKeyMode_for_Datastore.md)
- [0030_KeyCodecAndKeyProjectionDocumentationClarifications.md](./0030_KeyCodecAndKeyProjectionDocumentationClarifications.md)
- [0031_RecordId_CustomKeyEdgeCoverage_and_TurnoverInsertionOrderEviction.md](./0031_RecordId_CustomKeyEdgeCoverage_and_TurnoverInsertionOrderEviction.md)
- [0032_Activate_KeyToNativeScalar_Projection.md](./0032_Activate_KeyToNativeScalar_Projection.md)
- [0037_DefaultKeyComparatorDeterminism_and_DurableErrorTraceability.md](./0037_DefaultKeyComparatorDeterminism_and_DurableErrorTraceability.md)
- [0038_ConcurrentRecordKeyIndexBTreeAdapter_for_BTree_v0_0_3.md](./0038_ConcurrentRecordKeyIndexBTreeAdapter_for_BTree_v0_0_3.md)
- [0040_RemoveUnsafeConcurrentClear_from_RecordKeyIndexAdapter.md](./0040_RemoveUnsafeConcurrentClear_from_RecordKeyIndexAdapter.md)

## Storage / Backend

- [0003_AutoCommitControllerReuse_and_ErrorThrowContract.md](./0003_AutoCommitControllerReuse_and_ErrorThrowContract.md)
- [0006_PayloadReservedKeys_and_SharedStorageErrorNormalization.md](./0006_PayloadReservedKeys_and_SharedStorageErrorNormalization.md)
- [0012_CloseErrorAggregation_and_PageCorruptionPassThroughClarity.md](./0012_CloseErrorAggregation_and_PageCorruptionPassThroughClarity.md)
- [0014_CloseSingleFlight_and_FileTestHookIsolation.md](./0014_CloseSingleFlight_and_FileTestHookIsolation.md)
- [0016_SharedMetadataNonNegativeSafeIntegerValidator.md](./0016_SharedMetadataNonNegativeSafeIntegerValidator.md)
- [0022_TurnoverCapacityEvictionProgressGuard.md](./0022_TurnoverCapacityEvictionProgressGuard.md)
- [0023_InsertionOrderSentinelBoundaryGuard.md](./0023_InsertionOrderSentinelBoundaryGuard.md)
- [0029_RemoveTimestampAliasInput_for_Insert.md](./0029_RemoveTimestampAliasInput_for_Insert.md)
- [0036_AutoCommitDriverGuard_and_ConfigDefaultConsolidation.md](./0036_AutoCommitDriverGuard_and_ConfigDefaultConsolidation.md)
- [0057_WindowsDirectoryFsyncSkip_for_FileBackendCommit.md](./0057_WindowsDirectoryFsyncSkip_for_FileBackendCommit.md)

## Browser

- [0004_BackendLimit_Capacity_Mode_for_BrowserLocalStorage.md](./0004_BackendLimit_Capacity_Mode_for_BrowserLocalStorage.md)
- [0010_BrowserMetadataValidation_for_LoadSafety.md](./0010_BrowserMetadataValidation_for_LoadSafety.md)
- [0013_PayloadDepthLevelCounting_and_BrowserOverviewAlignment.md](./0013_PayloadDepthLevelCounting_and_BrowserOverviewAlignment.md)
- [0033_BrowserSyncStorageBackend_and_BackendLimitSupport.md](./0033_BrowserSyncStorageBackend_and_BackendLimitSupport.md)
- [0034_SyncStorageCommitResilience_and_CleanupBatching.md](./0034_SyncStorageCommitResilience_and_CleanupBatching.md)
- [0039_IndexedDBFirst_BrowserSingleWriterLeaseMode.md](./0039_IndexedDBFirst_BrowserSingleWriterLeaseMode.md)
- [0041_LocalStorageChunkCountIntegrity_and_BoundedCleanup.md](./0041_LocalStorageChunkCountIntegrity_and_BoundedCleanup.md)

## Build / Release / CI

- [0042_GitHubActions_CI_and_TagRelease_Pipeline.md](./0042_GitHubActions_CI_and_TagRelease_Pipeline.md)
- [0044_ES2020_BrowserBundleTarget_and_IIFE_Stability.md](./0044_ES2020_BrowserBundleTarget_and_IIFE_Stability.md)
- [0045_DualChannelPublishSeparation_for_Npm_and_BrowserReleaseAsset.md](./0045_DualChannelPublishSeparation_for_Npm_and_BrowserReleaseAsset.md)

## Superseded

- [0043_ES2022_BundlerProfile_for_BrowserBundle_and_Hybrid_Npm_Delivery.md](./0043_ES2022_BundlerProfile_for_BrowserBundle_and_Hybrid_Npm_Delivery.md) — superseded by 0044
- [0015_DocumentationAlignment_for_QueryShape_LockRecovery_and_ReadmeOnboarding.md](./0015_DocumentationAlignment_for_QueryShape_LockRecovery_and_ReadmeOnboarding.md) — partially superseded by later spec updates
