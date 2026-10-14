import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// magpie's icon in Omarchy's bar, put there by magpie (Settings → Bar icon).
// A click drops down its panel under the bar, where the click was; a right
// click opens its window. magpie is started if it isn't running.
BarWidget {
  id: root
  moduleName: "usemagpie.magpie"

  // written in by magpie when it puts the widget here
  readonly property string magpie: "__MAGPIE__"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: String.fromCodePoint(0xf15c6) // nf-md-bird
    tooltipText: "magpie"
    onPressed: function(b) {
      Quickshell.execDetached(b === Qt.RightButton ? [root.magpie, "app"] : [root.magpie, "panel"])
    }
  }
}
