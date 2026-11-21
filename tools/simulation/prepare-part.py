"""Offline build utility for the electronics parts drawn on the bundled Strafer (REV Control Hub and Slim Battery,
goBILDA Pinpoint and 4-Bar odometry pods); requires cadquery-ocp-novtk 7.9.3.1.1 in a local Python environment.

Each vendor STEP is meshed to .cache/simulation-cad/parts/<name>-native.glb in millimetres, its own frame, with its
colours. finish-robot.mjs places them on the chassis. STEP inputs are cached, not redistributed.
"""
import sys
from pathlib import Path
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDF import TDF_LabelSequence
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.RWGltf import RWGltf_CafWriter
from OCP.TColStd import TColStd_IndexedDataMapOfStringString
from OCP.Message import Message_ProgressRange
from OCP.IFSelect import IFSelect_RetDone
from OCP.RWMesh import RWMesh_CoordinateSystem

source, name = sys.argv[1:3]
assert name in ('control-hub', 'slim-battery', 'pinpoint', 'odometry-pod')
root = Path(__file__).resolve().parents[2]
doc = TDocStd_Document(TCollection_ExtendedString('Deck part'))
reader = STEPCAFControl_Reader()
reader.SetColorMode(True)
reader.SetNameMode(True)
assert reader.ReadFile(source) == IFSelect_RetDone
assert reader.Transfer(doc)
tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
labels = TDF_LabelSequence()
tool.GetFreeShapes(labels)
for i in range(1, labels.Length()+1):
    BRepMesh_IncrementalMesh(tool.GetShape_s(labels.Value(i)), .2, False, .4, True)
output = root / '.cache' / 'simulation-cad' / 'parts' / (name+'-native.glb')
output.parent.mkdir(parents=True, exist_ok=True)
writer = RWGltf_CafWriter(TCollection_AsciiString(str(output)), True)
converter = writer.ChangeCoordinateSystemConverter()
converter.SetInputLengthUnit(.001)
converter.SetOutputLengthUnit(.001)  # Millimetres, as the STEP has them.
converter.SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
converter.SetOutputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
writer.SetMergeFaces(True)
assert writer.Perform(doc, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange())
print(name, output.stat().st_size, 'bytes', flush=True)
