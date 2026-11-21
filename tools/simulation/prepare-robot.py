"""Offline build utility; requires cadquery-ocp-novtk 7.9.3.1.1 in a local Python environment.

STEP inputs are cached, not redistributed. The output retains the assembly tree, part names,
materials and placement for the two bundled examples. The app needs neither Python nor OCP.
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
# strafer-140 and mecanum-96-a/-b: goBILDA's 140 mm Strafer kit and its 96 mm wheel set's two wheels, for the kit's other wheel sets.
assert name in ('strafer', 'strafer-140', 'mecanum-96-a', 'mecanum-96-b', 'swechanum', 'decode-field')
root = Path(__file__).resolve().parents[2]
doc = TDocStd_Document(TCollection_ExtendedString('Deck CAD'))
reader = STEPCAFControl_Reader()
reader.SetColorMode(True)
reader.SetNameMode(True)
print('Reading', name, flush=True)
assert reader.ReadFile(source) == IFSelect_RetDone
assert reader.Transfer(doc)
tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
labels = TDF_LabelSequence()
tool.GetFreeShapes(labels)
for i in range(1, labels.Length()+1):
    print('Meshing root', i, flush=True)
    shape = tool.GetShape_s(labels.Value(i))
    BRepMesh_IncrementalMesh(shape, .35, False, .4, True)
output = root / '.cache' / 'simulation-cad' / (name+'-native.glb')
output.parent.mkdir(parents=True, exist_ok=True)
writer = RWGltf_CafWriter(TCollection_AsciiString(str(output)), True)
converter = writer.ChangeCoordinateSystemConverter()
converter.SetInputLengthUnit(.001)  # OCCT STEP reader normalizes the document to millimetres.
converter.SetOutputLengthUnit(.0254)  # Keep robot coordinates in inches in our local GLB.
converter.SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
converter.SetOutputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
writer.SetMergeFaces(True)
print('Writing', output, flush=True)
assert writer.Perform(doc, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange())
print('Done:', output.stat().st_size, 'bytes', flush=True)
