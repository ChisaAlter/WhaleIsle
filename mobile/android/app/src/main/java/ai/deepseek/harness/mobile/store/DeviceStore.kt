package ai.deepseek.harness.mobile.store

interface DeviceStore {
    var webAppUrl: String
    var scheme: String
    var computersJson: String
    var draftsJson: String
    var selectedComputer: String
    var nativeMigrationDone: Boolean
    fun clearLegacyHttpCredentials()
}
